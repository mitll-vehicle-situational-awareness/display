"""
Flask backend for:
- Radar points (live via SensorPackage callback, with CSV fallback)
- MJPEG webcam stream with YOLOv8n ONNX overlays
- Latest detections endpoint

Notes / fixes included:
- use_reloader=False (camera + Flask reloader don't mix)
- threaded=True for streaming
- radar_callback defined once BEFORE attaching
- YOLO: setInput(blob) BEFORE forward()
- YOLO output parsing handles common ONNX shapes and avoids numpy-scalar TypeErrors
- generator is guarded so a single bad frame won't kill the stream
"""

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import csv
import os
import sys
import cv2
import numpy as np
import threading
from typing import List, Dict, Any, Optional

# ----------------------------
# Optional ECE SDK import
# ----------------------------
try:
    from sensor_package import SensorPackage
except ImportError:
    SensorPackage = None


app = Flask(__name__)
CORS(app)

# ----------------------------
# Paths
# ----------------------------
BACKEND_DIR = os.path.dirname(__file__)
ONNX_PATH = os.path.join(BACKEND_DIR, "yolov8n.onnx")
NAMES_PATH = os.path.join(BACKEND_DIR, "coco.names")


# ----------------------------
# Radar state (live stream)
# ----------------------------
latest_radar_points: List[Dict[str, float]] = []
radar_lock = threading.Lock()
sensor = None


def radar_callback(frame: Any) -> None:
    """
    Called by the SDK whenever a new radar frame is available.

    Expected frame format (common):
    {
        "timestamp": float,
        "points": [{"x":..,"y":..,"z":..}, ...]
    }

    We store only the points list for fast API responses.
    """
    global latest_radar_points
    if frame is None:
        return

    pts = frame.get("points", frame)  # tolerate frame already being points
    if not isinstance(pts, list):
        return

    # normalize to list of dicts with x,y,z if possible
    cleaned = []
    for p in pts:
        if not isinstance(p, dict):
            continue
        try:
            x = float(p.get("x", p.get("detected_x_m", 0.0)))
            y = float(p.get("y", p.get("detected_y_m", 0.0)))
            z = float(p.get("z", p.get("detected_z_m", 0.0)))
            cleaned.append({"x": x, "y": y, "z": z})
        except Exception:
            continue

    with radar_lock:
        latest_radar_points = cleaned


def init_radar_sensor() -> None:
    """Attach callback + start sensor stream if SDK available."""
    global sensor
    if SensorPackage is None:
        print("SensorPackage not available (ImportError). Radar will use CSV fallback.")
        return

    try:
        sensor = SensorPackage()
        sensor.attach_callback("radar_listener", radar_callback)
        sensor.start()
        print("Radar sensor stream started.")
    except Exception as e:
        sensor = None
        print("Radar sensor not available:", e)


# ----------------------------
# CSV helpers (radar fallback)
# ----------------------------
def get_repo_root() -> str:
    # backend/ is one level under repo root (Capstone/display)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def resolve_csv_path(file_param: str):
    filename = "detected_positions2.csv" if file_param == "2" else "detected_positions.csv"
    csv_path = os.path.join(get_repo_root(), filename)
    return filename, csv_path


def read_points_from_csv(csv_path: str) -> List[Dict[str, float]]:
    points: List[Dict[str, float]] = []
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


# ----------------------------
# YOLO state
# ----------------------------
yolo_net: Optional[cv2.dnn.Net] = None
yolo_labels: List[str] = []
yolo_colors: Optional[np.ndarray] = None

current_detections: List[Dict[str, Any]] = []
detections_lock = threading.Lock()


def load_yolo() -> None:
    """Load YOLO ONNX + names once."""
    global yolo_net, yolo_labels, yolo_colors

    if yolo_net is not None:
        return

    if not (os.path.exists(ONNX_PATH) and os.path.exists(NAMES_PATH)):
        print("YOLO files not found in backend/. Streaming raw frames only.")
        return

    with open(NAMES_PATH, "r") as f:
        yolo_labels = [ln.strip() for ln in f if ln.strip()]

    yolo_colors = np.random.randint(0, 255, size=(len(yolo_labels), 3), dtype="uint8")

    yolo_net = cv2.dnn.readNet(ONNX_PATH)
    yolo_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    yolo_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

    print("YOLO loaded:", ONNX_PATH)


def make_camera(src: int = 0) -> cv2.VideoCapture:
    """Platform-specific backend selection improves reliability."""
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)
    elif sys.platform == "darwin":
        cap = cv2.VideoCapture(src, cv2.CAP_AVFOUNDATION)
    else:
        cap = cv2.VideoCapture(src, cv2.CAP_V4L2)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return cap


def _parse_yolov8_output(out: np.ndarray) -> Optional[np.ndarray]:
    """
    Normalize common YOLOv8 ONNX shapes into (N, 84):
    - (1, 84, N) -> squeeze -> (84, N) -> transpose
    - (1, N, 84) -> squeeze -> (N, 84)
    - (84, N) or (N, 84)
    """
    out = np.squeeze(out)

    if out.ndim != 2:
        # try to coerce to 2D
        out = out.reshape(-1, out.shape[-1])

    # Ensure detections are rows, 84 columns
    if out.shape[1] == 84:
        return out  # (N, 84)
    if out.shape[0] == 84 and out.shape[1] != 84:
        return out.T  # (N, 84)

    return None


def gen_frames(
    src: int = 0,
    skip: int = 4,
    input_size: int = 640,
    conf_threshold: float = 0.5,
    nms_threshold: float = 0.4,
):
    """
    MJPEG stream generator. Runs YOLO every `skip` frames and reuses boxes between runs.
    """
    load_yolo()
    cap = make_camera(src)
    if not cap.isOpened():
        print("Camera could not be opened.")
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

            H, W = frame.shape[:2]

            # If YOLO isn't loaded, just stream raw frames
            if yolo_net is None:
                ok, buffer = cv2.imencode(".jpg", frame)
                if ok:
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
                    )
                continue

            # Run detection every `skip` frames
            if frame_count % max(1, skip) == 0:
                try:
                    blob = cv2.dnn.blobFromImage(
                        frame, 1 / 255.0, (input_size, input_size), swapRB=True, crop=False
                    )
                    yolo_net.setInput(blob)
                    outputs = yolo_net.forward()  # ONNX typically returns a single output

                    out = _parse_yolov8_output(outputs)
                    if out is None:
                        # can't interpret -> skip detection but still stream frame
                        draw_indices = list(last_draw_indices)
                    else:
                        boxes = []
                        confidences = []
                        classIDs = []

                        for det in out:
                            # det: [cx, cy, w, h, scores...]
                            cx, cy, bw, bh = det[0:4].astype(float).tolist()
                            scores = det[4:]

                            class_id = int(np.argmax(scores))
                            conf = float(scores[class_id])
                            if conf < conf_threshold:
                                continue

                            # Some exports are normalized (0..1). If so, scale up.
                            if cx <= 1.5 and cy <= 1.5 and bw <= 1.5 and bh <= 1.5:
                                cx *= W
                                cy *= H
                                bw *= W
                                bh *= H

                            x1 = int(cx - bw / 2)
                            y1 = int(cy - bh / 2)

                            boxes.append([x1, y1, int(bw), int(bh)])
                            confidences.append(conf)
                            classIDs.append(class_id)

                        idxs = cv2.dnn.NMSBoxes(boxes, confidences, conf_threshold, nms_threshold)

                        last_boxes = boxes
                        last_confidences = confidences
                        last_classIDs = classIDs

                        draw_indices = []
                        if len(idxs) > 0:
                            try:
                                draw_indices = idxs.flatten().astype(int).tolist()
                            except Exception:
                                draw_indices = [int(i) for i in idxs]

                        last_draw_indices = draw_indices

                        # Update global detections (fresh)
                        with detections_lock:
                            current_detections.clear()
                            for i in last_draw_indices:
                                try:
                                    label = yolo_labels[last_classIDs[i]] if yolo_labels else str(last_classIDs[i])
                                    current_detections.append(
                                        {"label": label, "confidence": round(float(last_confidences[i]), 3)}
                                    )
                                except Exception:
                                    pass

                except Exception as e:
                    print("YOLO error (continuing stream):", e)
                    draw_indices = list(last_draw_indices)
            else:
                draw_indices = list(last_draw_indices)

            # Draw boxes
            for i in draw_indices:
                try:
                    x, y, w, h = last_boxes[i]
                    class_id = last_classIDs[i]
                    conf = last_confidences[i]
                    color = [int(c) for c in yolo_colors[class_id]] if yolo_colors is not None else (0, 255, 0)

                    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

                    label = yolo_labels[class_id] if yolo_labels and class_id < len(yolo_labels) else str(class_id)
                    text = f"{label}: {conf:.2f}"
                    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(frame, (x, max(0, y - th - 6)), (x + tw, y), color, -1)
                    cv2.putText(frame, text, (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                except Exception:
                    continue

            ok, buffer = cv2.imencode(".jpg", frame)
            if ok:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
                )

            frame_count += 1

    finally:
        cap.release()


# ----------------------------
# API endpoints
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
def radar_points():
    """
    Returns radar points either from:
    1) Live radar SDK stream
    2) CSV fallback (simulation)
    """
    with radar_lock:
        pts = list(latest_radar_points)

    if pts:
        return jsonify({"source": "live", "count": len(pts), "points": pts})

    # fallback to CSV simulation
    return get_data()


@app.route("/api/webcam")
def webcam():
    """
    MJPEG stream endpoint with YOLO overlays.
    Use /api/webcam?src=0 (default) or src=1.
    Optional tuning:
    - /api/webcam?skip=6&size=320
    """
    src = request.args.get("src", default="0")
    skip = request.args.get("skip", default="4")
    size = request.args.get("size", default="640")

    try:
        src_int = int(src)
    except ValueError:
        src_int = 0

    try:
        skip_int = max(1, int(skip))
    except ValueError:
        skip_int = 4

    try:
        size_int = int(size)
    except ValueError:
        size_int = 640

    resp = Response(
        gen_frames(src_int, skip=skip_int, input_size=size_int),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/api/detections")
def get_detections():
    """Returns the latest detected objects from the webcam stream."""
    with detections_lock:
        return jsonify({"detections": list(current_detections)})


# ----------------------------
# Main
# ----------------------------
if __name__ == "__main__":
    init_radar_sensor()
    try:
        # IMPORTANT: reloader off for camera streaming stability
        app.run(
            debug=True,
            use_reloader=False,
            threaded=True,
            port=5001,
            host="0.0.0.0",
        )
    finally:
        if sensor is not None:
            try:
                sensor.stop()
            except Exception:
                pass
