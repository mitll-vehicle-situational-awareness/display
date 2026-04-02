from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import csv
import os
import cv2
import numpy as np
import platform
import threading

app = Flask(__name__)
CORS(app)

# ----------------------------
# Camera setup
# ----------------------------
USE_PI_CAMERA = False
_picam2 = None
_cap = None

if platform.system() == "Linux":
    try:
        from picamera2 import Picamera2
        USE_PI_CAMERA = True
        print("PiCamera2 available, using Raspberry Pi camera")
    except ImportError:
        print("Picamera2 not available, falling back to OpenCV webcam")
        USE_PI_CAMERA = False
else:
    print("Not on Linux, using OpenCV webcam")


def get_camera():
    global _picam2, _cap

    if USE_PI_CAMERA:
        if _picam2 is None:
            _picam2 = Picamera2()
            _picam2.configure(
                _picam2.create_preview_configuration(
                    main={"format": "RGB888", "size": (1280, 720)}
                )
            )
            _picam2.start()
        return _picam2
    else:
        if _cap is None:
            _cap = cv2.VideoCapture(0)
        return _cap


def capture_frame():
    if USE_PI_CAMERA:
        picam2 = get_camera()
        frame_rgb = picam2.capture_array()
        frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        frame = cv2.rotate(frame, cv2.ROTATE_180)
        return frame
    else:
        cap = get_camera()
        ret, frame = cap.read()
        if not ret:
            return None
        return frame


# ----------------------------
# Radar CSV helpers
# ----------------------------
def read_points_from_csv(csv_path: str):
    points = []
    with open(csv_path, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                x = float(row.get("detected_x_m", row.get("x")))
                y = float(row.get("detected_y_m", row.get("y")))
                z = float(row.get("detected_z_m", row.get("z")))
                points.append({"x": x, "y": y, "z": z})
            except (TypeError, ValueError):
                continue
    return points


def get_repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def resolve_csv_path(file_param: str):
    filename = "detected_positions2.csv" if file_param == "2" else "detected_positions.csv"
    csv_path = os.path.join(get_repo_root(), filename)
    return filename, csv_path


@app.route("/api/data")
def get_data():
    file_param = request.args.get("file", "1")
    filename, csv_path = resolve_csv_path(file_param)

    if not os.path.exists(csv_path):
        return jsonify({"error": f"CSV not found: {filename}"}), 404

    points = read_points_from_csv(csv_path)
    return jsonify({"file": filename, "count": len(points), "points": points})


@app.route("/api/radar-points")
def radar_points_alias():
    return get_data()


# ----------------------------
# Webcam streaming with YOLOv8 overlays
# ----------------------------
_backend_dir = os.path.dirname(__file__)
_onnx_path = os.path.join(_backend_dir, "yolov8n.onnx")
_names_path = os.path.join(_backend_dir, "coco.names")

yolo_net = None
yolo_layer_names = []
yolo_labels = []
yolo_colors = None

current_detections = []
detections_lock = threading.Lock()


def load_yolo():
    global yolo_net, yolo_layer_names, yolo_labels, yolo_colors

    if yolo_net is not None:
        return

    if not (os.path.exists(_onnx_path) and os.path.exists(_names_path)):
        print("YOLO files not found in backend/. Skipping detection overlay.")
        return

    with open(_names_path, "r") as f:
        yolo_labels = [line.strip() for line in f if line.strip()]

    yolo_colors = np.random.randint(0, 255, size=(len(yolo_labels), 3), dtype="uint8")

    yolo_net = cv2.dnn.readNet(_onnx_path)
    yolo_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    yolo_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

    yolo_layer_names = yolo_net.getUnconnectedOutLayersNames()
    print("YOLO model loaded")


def gen_frames(skip: int = 4, conf_threshold: float = 0.15, nms_threshold: float = 0.4):
    load_yolo()

    frame_count = 0
    last_boxes = []
    last_confidences = []
    last_classIDs = []
    last_draw_indices = []

    while True:
        frame = capture_frame()
        if frame is None:
            continue

        (H, W) = frame.shape[:2]

        if yolo_net is None:
            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
            )
            frame_count += 1
            continue

        if frame_count % max(1, skip) == 0:
            blob = cv2.dnn.blobFromImage(frame, 1 / 255.0, (640, 640), swapRB=False, crop=False)
            yolo_net.setInput(blob)
            outputs = yolo_net.forward(yolo_layer_names)

            raw = outputs[0]
            data = raw[0]

            cx = data[0]
            cy = data[1]
            bw = data[2]
            bh = data[3]
            scores = data[4:]

            class_ids_all = np.argmax(scores, axis=0)
            confidences_all = scores[class_ids_all, np.arange(scores.shape[1])]

            boxes = []
            confidences = []
            classIDs = []

            mask = confidences_all > conf_threshold
            for i in np.where(mask)[0]:
                confidence = float(confidences_all[i])
                class_id = int(class_ids_all[i])

                center_x = int(float(cx[i]) * W)
                center_y = int(float(cy[i]) * H)
                width = int(float(bw[i]) * W)
                height = int(float(bh[i]) * H)

                x1 = center_x - width // 2
                y1 = center_y - height // 2

                boxes.append([x1, y1, width, height])
                confidences.append(confidence)
                classIDs.append(class_id)

            last_boxes = boxes
            last_confidences = confidences
            last_classIDs = classIDs

            idxs = cv2.dnn.NMSBoxes(boxes, confidences, conf_threshold, nms_threshold)

            draw_indices = []
            if len(idxs) > 0:
                try:
                    draw_indices = idxs.flatten().astype(int).tolist()
                except Exception:
                    draw_indices = [int(i) for i in idxs]

            last_draw_indices = draw_indices

            with detections_lock:
                current_detections.clear()
                for i in last_draw_indices:
                    try:
                        current_detections.append({
                            "label": yolo_labels[last_classIDs[i]],
                            "confidence": round(float(last_confidences[i]), 3)
                        })
                    except Exception:
                        pass
        else:
            draw_indices = list(last_draw_indices)

        for i in draw_indices:
            try:
                (x, y) = (last_boxes[i][0], last_boxes[i][1])
                (w, h) = (last_boxes[i][2], last_boxes[i][3])
                color = [int(c) for c in yolo_colors[last_classIDs[i]]]

                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

                text = f"{yolo_labels[last_classIDs[i]]}: {last_confidences[i]:.2f}"
                (text_w, text_h), _ = cv2.getTextSize(
                    text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
                )
                cv2.rectangle(frame, (x, y - text_h - 6), (x + text_w, y), color, -1)
                cv2.putText(
                    frame,
                    text,
                    (x, y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (255, 255, 255),
                    1,
                )
            except Exception:
                continue

        ok, buffer = cv2.imencode(".jpg", frame)
        if not ok:
            frame_count += 1
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
        )

        frame_count += 1


@app.route("/api/webcam")
def webcam():
    return Response(
        gen_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/api/detections")
def get_detections():
    with detections_lock:
        return jsonify({"detections": list(current_detections)})


if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0")
