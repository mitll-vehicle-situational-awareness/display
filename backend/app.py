from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import csv
import os
import sys
import cv2
import numpy as np

app = Flask(__name__)
CORS(app)


# ----------------------------
# Radar CSV helpers (now includes z)
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
                # TypeError covers None -> float(None) when missing columns
                continue
    return points


def get_repo_root():
    # backend/ is one level under repo root
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def resolve_csv_path(file_param: str):
    filename = "detected_positions2.csv" if file_param == "2" else "detected_positions.csv"
    csv_path = os.path.join(get_repo_root(), filename)
    return filename, csv_path


# ----------------------------
# Basic endpoints
# ----------------------------
@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from the Flask backend!"})


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
# Webcam streaming (MJPEG) with YOLOv3 overlays
# ----------------------------
def make_camera(src: int = 0):
    # Platform-specific backend selection improves reliability
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)  # Windows
    elif sys.platform == "darwin":
        cap = cv2.VideoCapture(src, cv2.CAP_AVFOUNDATION)  # macOS
    else:
        cap = cv2.VideoCapture(src, cv2.CAP_V4L2)  # Linux

    # Optional: request resolution (camera may ignore)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return cap


# Load YOLO model and class names (once)
_backend_dir = os.path.dirname(__file__)
_cfg_path = os.path.join(_backend_dir, "yolov3.cfg")
_weights_path = os.path.join(_backend_dir, "yolov3.weights")
_names_path = os.path.join(_backend_dir, "coco.names")

yolo_net = None
yolo_layer_names = []
yolo_labels = []
yolo_colors = None

# Global state: store latest detections for API access
current_detections = []
detections_lock = __import__('threading').Lock()


def load_yolo():
    global yolo_net, yolo_layer_names, yolo_labels, yolo_colors
    if yolo_net is not None:
        return

    if not (os.path.exists(_cfg_path) and os.path.exists(_weights_path) and os.path.exists(_names_path)):
        print("YOLO files not found in backend/. Skipping detection overlay.")
        return

    yolo_labels = []
    with open(_names_path, "r") as f:
        for line in f:
            name = line.strip()
            if name:
                yolo_labels.append(name)

    yolo_colors = np.random.randint(0, 255, size=(len(yolo_labels), 3), dtype="uint8")

    yolo_net = cv2.dnn.readNetFromDarknet(_cfg_path, _weights_path)
    # Use CPU backend by default; uncomment to try CUDA if available
    # yolo_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
    # yolo_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)

    # determine output layer names
    ln = yolo_net.getLayerNames()
    try:
        yolo_layer_names = [ln[i[0] - 1] for i in yolo_net.getUnconnectedOutLayers()]
    except Exception:
        # compatibility fallback
        yolo_layer_names = [ln[i - 1] for i in yolo_net.getUnconnectedOutLayers()]


def gen_frames(src: int = 0, skip: int = 4, input_size: int = 416, conf_threshold: float = 0.5, nms_threshold: float = 0.4):
    """
    Stream frames from `src` while running YOLO inference only every `skip` frames.
    `input_size` controls the DNN input (smaller => faster, less accurate).
    """
    load_yolo()
    cap = make_camera(src)
    if not cap.isOpened():
        return

    frame_count = 0
    last_boxes = []
    last_confidences = []
    last_classIDs = []
    last_draw_indices = []

    try:
        while True:
            success, frame = cap.read()
            if not success:
                break

            (H, W) = frame.shape[:2]

            # If YOLO isn't available, just stream raw frames
            if yolo_net is None:
                ok, buffer = cv2.imencode(".jpg", frame)
                if not ok:
                    continue
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
                )
                continue

            # Only run the heavy detection every `skip` frames
            if frame_count % max(1, skip) == 0:
                blob = cv2.dnn.blobFromImage(frame, 1 / 255.0, (input_size, input_size), swapRB=True, crop=False)
                yolo_net.setInput(blob)
                layer_outputs = yolo_net.forward(yolo_layer_names)

                boxes = []
                confidences = []
                classIDs = []

                for output in layer_outputs:
                    for detection in output:
                        scores = detection[5:]
                        classID = np.argmax(scores)
                        confidence = float(scores[classID])

                        if confidence > conf_threshold:
                            box = detection[0:4] * np.array([W, H, W, H])
                            (centerX, centerY, width, height) = box.astype("int")

                            x = int(centerX - (width / 2))
                            y = int(centerY - (height / 2))

                            boxes.append([x, y, int(width), int(height)])
                            confidences.append(float(confidence))
                            classIDs.append(classID)

                idxs = []
                if len(boxes) > 0:
                    idxs = cv2.dnn.NMSBoxes(boxes, confidences, conf_threshold, nms_threshold)

                # store last detections to reuse on skipped frames
                last_boxes = boxes
                last_confidences = confidences
                last_classIDs = classIDs

                draw_indices = []
                if len(idxs) > 0:
                    try:
                        draw_indices = idxs.flatten().astype(int).tolist()
                    except Exception:
                        # sometimes idxs is already a flat list or tuple
                        draw_indices = [int(i) for i in idxs]

                # persist the selected indices so skipped frames draw the same filtered set
                last_draw_indices = draw_indices
            else:
                # reuse last detection indices (NMS-selected) on skipped frames
                draw_indices = list(last_draw_indices)

            # Update global detections state (only freshly computed detections)
            if frame_count % max(1, skip) == 0 and len(last_draw_indices) > 0:
                with detections_lock:
                    current_detections.clear()
                    for i in last_draw_indices:
                        try:
                            label = yolo_labels[last_classIDs[i]]
                            confidence = last_confidences[i]
                            current_detections.append({
                                "label": label,
                                "confidence": round(float(confidence), 3)
                            })
                        except Exception:
                            pass

            # Draw (either freshly computed or reused) boxes
            for i in draw_indices:
                try:
                    (x, y) = (last_boxes[i][0], last_boxes[i][1])
                    (w, h) = (last_boxes[i][2], last_boxes[i][3])
                    color = [int(c) for c in yolo_colors[last_classIDs[i]]]
                    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
                    text = f"{yolo_labels[last_classIDs[i]]}: {last_confidences[i]:.2f}"
                    (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(frame, (x, y - text_h - 6), (x + text_w, y), color, -1)
                    cv2.putText(frame, text, (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
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
    finally:
        cap.release()


@app.route("/api/webcam")
def webcam():
    """
    MJPEG stream endpoint with YOLO overlays.
    Use /api/webcam?src=0 (default) or src=1 if you have multiple cameras.
    """
    src = request.args.get("src", default="0")
    try:
        src_int = int(src)
    except ValueError:
        src_int = 0

    return Response(
        gen_frames(src_int),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/api/detections")
def get_detections():
    """
    Returns the latest detected objects from the webcam stream.
    Format: [{"label": "person", "confidence": 0.95}, ...]
    """
    with detections_lock:
        return jsonify({"detections": list(current_detections)})


if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0")
