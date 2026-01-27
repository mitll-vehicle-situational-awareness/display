from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import csv
import os
import cv2

app = Flask(__name__)
CORS(app)

# ----------------------------
# Radar CSV helpers (unchanged)
# ----------------------------
def read_points_from_csv(csv_path: str):
    points = []
    with open(csv_path, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                x = float(row["detected_x_m"])
                y = float(row["detected_y_m"])
                points.append({"x": x, "y": y})
            except (KeyError, ValueError):
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
# Webcam streaming (MJPEG)
# ----------------------------
def make_camera(src: int = 0):
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(src, cv2.CAP_DSHOW)
    elif sys.platform == "darwin":
        cap = cv2.VideoCapture(src)
    else:
        cap = cv2.VideoCapture(src, cv2.CAP_V4L2)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return cap


def gen_frames(src: int = 0):
    cap = make_camera(src)
    if not cap.isOpened():
        # can't open camera; stop stream
        return

    try:
        while True:
            success, frame = cap.read()
            if not success:
                break

            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                continue

            frame_bytes = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
    finally:
        cap.release()


@app.route("/api/webcam")
def webcam():
    """
    MJPEG stream endpoint.
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


if __name__ == "__main__":
    # Keep 5001 because macOS often steals 5000
    app.run(debug=True, port=5001, host="0.0.0.0")
