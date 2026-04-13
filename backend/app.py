from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import csv
import os
import sys
import cv2
import numpy as np
import threading
import time
from PIL import Image
import io
import base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# --------------------------------------------------
# Import live radar/camera interface from ECE_TEST
# --------------------------------------------------
SDK_DIR = "/home/seniordesign/clean_dir/ECE_TEST/sdk"
CONFIG_PATH = "/home/seniordesign/clean_dir/ECE_TEST/test_folder/GoodCfg_Matlab.cfg"
BACKEND_DIR = os.path.dirname(__file__)

if SDK_DIR not in sys.path:
    sys.path.append(SDK_DIR)

if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from interface import RadarCameraInterface
from processing import RadarSensor, EPSILON

app = Flask(__name__)
CORS(app)

# --------------------------------------------------
# Shared live state
# --------------------------------------------------
state_lock = threading.Lock()

latest_timestamp = None
latest_camera_jpeg = None
latest_camera_bgr = None
latest_radar_buf = None
current_detections = []

interface_started = False

IMAGE_WIDTH = 1280
IMAGE_HEIGHT = 720

# --------------------------------------------------
# Radar CSV helpers (kept for your current radar card)
# --------------------------------------------------
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

# --------------------------------------------------
# YOLO setup
# --------------------------------------------------
_backend_dir = os.path.dirname(__file__)
_onnx_path = os.path.join(_backend_dir, "yolov8n.onnx")
_names_path = os.path.join(_backend_dir, "coco.names")

yolo_net = None
yolo_layer_names = []
yolo_labels = []
yolo_colors = None


def load_yolo():
    global yolo_net, yolo_layer_names, yolo_labels, yolo_colors

    if yolo_net is not None:
        return

    if not (os.path.exists(_onnx_path) and os.path.exists(_names_path)):
        print("YOLO files not found in backend/. Skipping detection overlay.")
        return

    with open(_names_path, "r") as f:
        yolo_labels[:] = [line.strip() for line in f if line.strip()]

    yolo_colors = np.random.randint(0, 255, size=(len(yolo_labels), 3), dtype="uint8")

    yolo_net = cv2.dnn.readNet(_onnx_path)
    yolo_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    yolo_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    yolo_layer_names = yolo_net.getUnconnectedOutLayersNames()


def run_yolo_on_frame(frame_bgr, conf_threshold=0.15, nms_threshold=0.4):
    if yolo_net is None:
        return frame_bgr, []

    frame = frame_bgr.copy()
    h, w = frame.shape[:2]

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
    class_ids = []

    mask = confidences_all > conf_threshold
    for i in np.where(mask)[0]:
        confidence = float(confidences_all[i])
        class_id = int(class_ids_all[i])

        center_x = int(float(cx[i]) * w)
        center_y = int(float(cy[i]) * h)
        width = int(float(bw[i]) * w)
        height = int(float(bh[i]) * h)

        x1 = center_x - width // 2
        y1 = center_y - height // 2

        boxes.append([x1, y1, width, height])
        confidences.append(confidence)
        class_ids.append(class_id)

    idxs = cv2.dnn.NMSBoxes(boxes, confidences, conf_threshold, nms_threshold)

    detections = []
    draw_indices = []

    if len(idxs) > 0:
        try:
            draw_indices = idxs.flatten().astype(int).tolist()
        except Exception:
            draw_indices = [int(i) for i in idxs]

    for i in draw_indices:
        try:
            x, y, bw2, bh2 = boxes[i]
            color = [int(c) for c in yolo_colors[class_ids[i]]]

            cv2.rectangle(frame, (x, y), (x + bw2, y + bh2), color, 2)
            text = f"{yolo_labels[class_ids[i]]}: {confidences[i]:.2f}"
            (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x, y - text_h - 6), (x + text_w, y), color, -1)
            cv2.putText(frame, text, (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

            detections.append({
                "label": yolo_labels[class_ids[i]],
                "confidence": round(float(confidences[i]), 3),
            })
        except Exception:
            continue

    return frame, detections

# --------------------------------------------------
# Live sensor callback
# --------------------------------------------------
def sensor_callback(timestamp, image_buf, radar_buf):
    global latest_timestamp, latest_camera_jpeg, latest_camera_bgr, latest_radar_buf, current_detections
    
    try:
        print(f"Callback called, timestamp: {timestamp}, image_buf len: {len(image_buf)}")
        arr = np.frombuffer(image_buf, dtype=np.uint8).reshape(IMAGE_HEIGHT, IMAGE_WIDTH, 3)
        peek = np.frombuffer(radar_buf[:32], dtype=np.int16)
        print(f"DEBUG peek int16: {peek}")
        annotated_frame, detections = run_yolo_on_frame(arr)

        ok, buffer = cv2.imencode(".jpg", annotated_frame)
        if not ok:
            print("Failed to encode JPEG")
            return

        with state_lock:
            latest_timestamp = float(timestamp)
            latest_camera_bgr = annotated_frame
            latest_camera_jpeg = buffer.tobytes()
            latest_radar_buf = bytes(radar_buf)
            current_detections = detections

    except Exception as e:
        print("sensor_callback error:", e)

# --------------------------------------------------
# Start interface in background
# --------------------------------------------------
def start_sensor_interface():
    global interface_started

    if interface_started:
        return

    load_yolo()

    def runner():
        try:
            sensor = RadarCameraInterface(CONFIG_PATH)
            sensor.attach_callback("flask_live_callback", sensor_callback)
            sensor.start()
        except Exception as e:
            print("Sensor interface failed:", e)

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    interface_started = True
    print("Started RadarCameraInterface background thread.")

# --------------------------------------------------
# MJPEG stream from latest callback frame
# --------------------------------------------------
def gen_frames():
    while True:
        with state_lock:
            frame_bytes = latest_camera_jpeg

        if frame_bytes is None:
            time.sleep(0.05)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )

        time.sleep(0.03)


@app.route("/api/webcam")
def webcam():
    return Response(
        gen_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/api/detections")
def get_detections():
    with state_lock:
        return jsonify({
            "timestamp": latest_timestamp,
            "detections": list(current_detections),
        })


@app.route("/api/live-status")
def live_status():
    with state_lock:
        return jsonify({
            "interface_started": interface_started,
            "has_image": latest_camera_jpeg is not None,
            "has_radar": latest_radar_buf is not None,
            "timestamp": latest_timestamp,
            "num_detections": len(current_detections),
        })


# --------------------------------------------------
# Range-Doppler Heatmap
# --------------------------------------------------
_radar_sensor_cache = None
_radar_sensor_lock = threading.Lock()

def generate_range_doppler_heatmap(radar_buf):
    if radar_buf is None or len(radar_buf) == 0:
        return None
    try:
        NUM_TX, NUM_LOOPS, NUM_RX, NUM_ADC = 3, 16, 4, 256

        raw_int16 = np.frombuffer(radar_buf, dtype=np.int16)
        iq = raw_int16.reshape(-1, 2).astype(np.float32)
        radar_array = iq[:, 0] + 1j * iq[:, 1]
        frame_raw = radar_array.reshape(NUM_TX, NUM_LOOPS, NUM_RX, NUM_ADC)

        radar = RadarSensor(frame_raw)
        range_cube, rd_cube_txrx = radar.process_tdm_mimo_cube(frame_raw)
        # rd_cube_txrx is already fftshifted on doppler axis — do NOT shift again

        rd_power = np.sum(np.abs(rd_cube_txrx) ** 2, axis=(1, 2))  # [range, doppler]
        rd_db = 10.0 * np.log10(rd_power + EPSILON)

        # Plot with axes and colorbar to match the reference image style.
        fig, ax = plt.subplots(figsize=(8, 5), constrained_layout=True)
        extent = [radar.velocity_axis[0], radar.velocity_axis[-1], radar.range_axis[0], radar.range_axis[-1]]
        im = ax.imshow(
            rd_db,
            origin="lower",
            aspect="auto",
            cmap="viridis",
            vmin=np.max(rd_db) - 40.0,
            vmax=np.max(rd_db),
            extent=extent,
        )

        ax.set_title("Range-Doppler Map")
        ax.set_xlabel("Velocity (m/s)")
        ax.set_ylabel("Range (m)")
        cbar = fig.colorbar(im, ax=ax)
        cbar.set_label("Magnitude (dB)")

        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=100, bbox_inches="tight")
        plt.close(fig)
        buffer.seek(0)

        return Image.open(buffer).copy()

    except Exception as e:
        print(f"ERROR generating range-doppler heatmap: {e}")
        import traceback; traceback.print_exc()
        return None

@app.route("/api/range-doppler")
def get_range_doppler():
    """
    Endpoint to get the current range-doppler heatmap as base64.
    """
    with state_lock:
        radar_buf = latest_radar_buf
        timestamp = latest_timestamp
    
    if radar_buf is None:
        return jsonify({"error": "No radar data available", "image": None}), 204
    
    img = generate_range_doppler_heatmap(radar_buf)
    
    if img is None:
        return jsonify({"error": "Failed to generate heatmap", "image": None}), 500
    
    # Convert to base64 for transmission
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    img_base64 = base64.b64encode(buffer.getvalue()).decode()
    
    return jsonify({
        "timestamp": timestamp,
        "image": img_base64,
        "format": "base64"
    })


# start background interface once on server startup
start_sensor_interface()

if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0", use_reloader=False)