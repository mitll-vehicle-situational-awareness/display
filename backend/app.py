"""
app.py - Flask backend for radar-camera display
"""
from flask import Flask, jsonify, request, Response
import contextlib
import traceback
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

# Process every Nth frame; drop the rest. Set to 1 to process every frame.
FRAME_SKIP = 3
_frame_counter = 0

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
current_detections = []          # YOLO detections (with bbox + angular extent)
latest_radar_detections = []     # radar detections (with angles + association)
latest_frame_seq = 0             # monotonic counter; bumped by sensor_callback
                                 # for every new frame — reliable cache key
                                 # even when SDK timestamps are coarse or reused

interface_started = False

IMAGE_WIDTH = 1280
IMAGE_HEIGHT = 720

# The SDK hands us (H, W, 3) uint8 frames. Set this based on your SDK's
# documented pixel order. If colors on the dashboard look swapped (blue skin
# tones, magenta grass, etc.), flip this.
#   True  -> SDK emits RGB; we'll convert to BGR once up front so OpenCV
#            drawing + imencode behave correctly.
#   False -> SDK emits BGR (OpenCV native); no conversion needed.
SDK_IMAGE_IS_RGB = True

# --------------------------------------------------
# Radar frame config — matches helena_getframes.OUTPUT_BIN_CONFIG
# --------------------------------------------------
NUM_ADC_SAMPLES = 256
NUM_RX = 4
NUM_TX = 3
NUM_CHIRPS_PER_FRAME = 48
NUM_CHIRP_LOOPS = NUM_CHIRPS_PER_FRAME // NUM_TX  # 16

# Range subset used for detection + display (set both to None to skip trim).
MIN_RANGE = 0  # meters
MAX_RANGE = 2  # meters

# --------------------------------------------------
# Camera intrinsics (from OpenCV calibration)
# --------------------------------------------------
# Intrinsic matrix K and 5-element distortion vector D from cv2.calibrateCamera,
# in OpenCV's standard [k1, k2, p1, p2, k3] order. Reprojection error ≈ 1.03 px.
CAMERA_MATRIX = np.array([
    [541.2558914,   0.0,         646.22650984],
    [  0.0,       539.7169845,   362.32662103],
    [  0.0,         0.0,           1.0       ],
], dtype=np.float64)

DIST_COEFFS = np.array([
    -2.18634563e-02,   # k1
     5.70997112e-02,   # k2
    -3.50489678e-04,   # p1
    -5.55556432e-05,   # p2
    -4.37023072e-02,   # k3
], dtype=np.float64)

# Resolution at which calibration was performed. K and cx/cy scale linearly
# with image size, so we rescale per-frame (YOLO runs on a 640×360 resize,
# see sensor_callback).
CALIB_IMAGE_WIDTH = IMAGE_WIDTH    # 1280
CALIB_IMAGE_HEIGHT = IMAGE_HEIGHT  # 720

# Rigid angular offset between radar boresight and camera boresight.
# If the radar and camera are not perfectly aligned, add a bias here.
RADAR_AZ_OFFSET_DEG = 0.0
RADAR_EL_OFFSET_DEG = 0.0

# NOTE: angle-based association is currently disabled because
# phased_array_aoa on this hardware produces unreliable az/el. Matching is
# done by range only — see associate_radar_to_yolo. These constants are
# kept as config surface for if/when angle estimation becomes trustworthy.
ASSOCIATION_ANGULAR_PAD_DEG = 3.0
ASSOCIATION_MAX_DISTANCE_DEG = 25.0

# --------------------------------------------------
# CFAR sensitivity — lower = more peaks pass = more radar detections
# --------------------------------------------------
# How far above the local noise estimate a cell has to be (in dB) to count
# as a detection. processing.RadarSensor.detect_targets_2d defaults are
# 12 / 10 dB; we relax them so near-stationary targets (v≈0) aren't buried
# inside the static-clutter ridge. Tune up if you see too many false peaks,
# down if real targets are being missed.
RANGE_CFAR_THRESHOLD_DB = 8.0
DOPPLER_CFAR_THRESHOLD_DB = 6.0

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
# Pixel -> angle geometry (calibration-based)
# --------------------------------------------------
# Pipeline: pixel -> cv2.undistortPoints(K, D) -> normalized ray (x', y', 1)
# -> spherical angles. Normalized coords are what you get when you "remove
# distortion and divide by focal length", so x' = X/Z, y' = Y/Z on the unit-
# focal plane, independent of image resolution.
#
# From (x', y'):
#   az = arctan(x')                               # angle in the horizontal (x-z) plane
#   el = arctan(-y' / sqrt(x'^2 + 1))             # angle above the horizontal
# The sqrt(x'^2 + 1) in the elevation denominator makes az/el the proper
# spherical decomposition of the ray (x', y', 1) — using just arctan(-y')
# only agrees with it near the optical axis and skews off-axis.
# The minus sign flips image y (+down) into elevation (+up).

def _scaled_camera_matrix(img_w, img_h):
    """
    Return K rescaled from the calibration resolution to (img_w, img_h).
    The YOLO frame is a resize of the sensor frame, so fx/fy/cx/cy need to
    scale by the same ratio; distortion coefficients are in normalized
    coordinates and do not scale.
    """
    sx = img_w / float(CALIB_IMAGE_WIDTH)
    sy = img_h / float(CALIB_IMAGE_HEIGHT)
    K = CAMERA_MATRIX.copy()
    K[0, 0] *= sx  # fx
    K[1, 1] *= sy  # fy
    K[0, 2] *= sx  # cx
    K[1, 2] *= sy  # cy
    return K


def _undistort_pixels(pixels_xy, img_w, img_h):
    """
    pixels_xy: (N, 2) array of pixel coords in the current image size.
    Returns  : (N, 2) array of normalized (x', y') on the unit-focal plane,
               with lens distortion removed.
    """
    K = _scaled_camera_matrix(img_w, img_h)
    pts = np.asarray(pixels_xy, dtype=np.float64).reshape(-1, 1, 2)
    undist = cv2.undistortPoints(pts, K, DIST_COEFFS)  # shape (N, 1, 2)
    return undist.reshape(-1, 2)


def _normalized_to_az_el_deg(xp, yp):
    """(x', y') on the normalized plane -> (az_deg, el_deg), vectorized."""
    xp = np.asarray(xp, dtype=np.float64)
    yp = np.asarray(yp, dtype=np.float64)
    az = np.rad2deg(np.arctan(xp))
    el = np.rad2deg(np.arctan(-yp / np.sqrt(xp * xp + 1.0)))
    return az, el


def _pixel_to_angle(px, py, img_w, img_h):
    """Single-pixel helper: returns (az_deg, el_deg) for pixel (px, py)."""
    undist = _undistort_pixels(np.array([[px, py]]), img_w, img_h)
    xp, yp = undist[0, 0], undist[0, 1]
    az, el = _normalized_to_az_el_deg(xp, yp)
    return float(az), float(el)


def _bbox_to_angular_extent(bbox_xywh, img_w, img_h):
    """
    Angular (az, el) bounds of a bbox in degrees, using the calibrated camera
    model. All four corners are undistorted through cv2.undistortPoints and
    min/max over the corner angles gives the enclosing angular rectangle.

    Output convention: +az right, +el up (radar convention).
    """
    x1, y1, w, h = bbox_xywh
    x2, y2 = x1 + w, y1 + h
    corners = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float64)

    undist = _undistort_pixels(corners, img_w, img_h)
    az, el = _normalized_to_az_el_deg(undist[:, 0], undist[:, 1])

    return {
        "az_min_deg": float(np.min(az)),
        "az_max_deg": float(np.max(az)),
        "el_min_deg": float(np.min(el)),
        "el_max_deg": float(np.max(el)),
    }

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


def run_yolo_on_frame(frame, conf_threshold=0.15, nms_threshold=0.4):
    if yolo_net is None:
        return frame, []

    h, w = frame.shape[:2]

    # Frame is BGR by the time it reaches here (normalized in sensor_callback).
    # YOLO ONNX exports from ultralytics expect RGB input, so swapRB=True.
    blob = cv2.dnn.blobFromImage(frame, 1 / 255.0, (640, 640), swapRB=True, crop=False)
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

            bbox_xywh = [int(x), int(y), int(bw2), int(bh2)]
            angles = _bbox_to_angular_extent(bbox_xywh, w, h)

            # Camera-derived center angle of the bbox, via pinhole projection.
            # This is what we'll report as the detection's az/el everywhere —
            # it's more reliable than phased_array_aoa on this hardware.
            bbox_cx_px = x + bw2 / 2.0
            bbox_cy_px = y + bh2 / 2.0
            az_center, el_center = _pixel_to_angle(bbox_cx_px, bbox_cy_px, w, h)

            detections.append({
                "label": yolo_labels[class_ids[i]],
                "confidence": round(float(confidences[i]), 3),
                "bbox": bbox_xywh,
                "img_w": int(w),
                "img_h": int(h),
                "az_deg": round(az_center, 2),   # camera angle (bbox center)
                "el_deg": round(el_center, 2),   # camera angle (bbox center)
                **angles,
            })
        except Exception:
            continue

    return frame, detections

# --------------------------------------------------
# Live sensor callback
# --------------------------------------------------
def sensor_callback(timestamp, image_buf, radar_buf):
    global latest_timestamp, latest_camera_jpeg, latest_camera_bgr, latest_radar_buf, current_detections
    global _frame_counter, latest_frame_seq

    _frame_counter += 1
    if _frame_counter % FRAME_SKIP != 0:
        return

    try:
        # image_buf is already (720, 1280, 3) uint8 from the SDK.
        arr = np.ascontiguousarray(image_buf)

        # Normalize to BGR up front so every downstream OpenCV op (resize,
        # rectangle/putText drawing in run_yolo_on_frame, and imencode) sees
        # consistent input. Without this, an RGB-emitting SDK produces a JPEG
        # with red/blue channels swapped in the browser.
        if SDK_IMAGE_IS_RGB:
            arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

        small = cv2.resize(arr, (640, 360))
        annotated_frame, detections = run_yolo_on_frame(small)

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
            latest_frame_seq += 1

    except Exception as e:
        print("sensor_callback error:", e)
        traceback.print_exc()

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
# Range-Doppler Heatmap (new processing.py interface)
# --------------------------------------------------
_radar_sensor_cache = None
_radar_sensor_lock = threading.Lock()


def _unpack_radar_buf_to_frame(radar_buf):
    """
    Convert raw DCA1000 int16 IIQQ bytes into a single frame cube shaped
    [tx, chirp_loop, rx, adc].

    Mirrors helena_getframes._read_frame_with_processing_bin_logic — same
    IIQQ->IQIQ reorder, same reshape ordering (TX cycles fastest within a
    loop), same transpose to [tx, chirp_loop, rx, adc].
    """
    raw_data = np.frombuffer(radar_buf, dtype=np.int16)
    if raw_data.size == 0:
        return None

    # Align to IIQQ packet width (groups of 4 int16s).
    if raw_data.size % 4 != 0:
        raw_data = raw_data[: (raw_data.size // 4) * 4]

    # IIQQ -> IQIQ reorder, then combine into complex IQ.
    iq_reordered = np.copy(raw_data)
    iq_reordered[1::4] = raw_data[2::4]
    iq_reordered[2::4] = raw_data[1::4]
    iq_data = iq_reordered[0::2] + 1j * iq_reordered[1::2]

    samples_per_frame = NUM_CHIRPS_PER_FRAME * NUM_RX * NUM_ADC_SAMPLES
    num_frames = iq_data.size // samples_per_frame
    if num_frames < 1:
        print(
            f"radar_buf too small: {iq_data.size} IQ samples, "
            f"need {samples_per_frame} for one frame."
        )
        return None

    # Keep only complete frames, then extract frame 0 (matches helena).
    iq_data = iq_data[: num_frames * samples_per_frame]
    data = iq_data.reshape(num_frames, NUM_CHIRPS_PER_FRAME, NUM_RX, NUM_ADC_SAMPLES)
    data = data.reshape(num_frames, NUM_CHIRP_LOOPS, NUM_TX, NUM_RX, NUM_ADC_SAMPLES)
    data = np.transpose(data, (0, 2, 1, 3, 4))
    return data[0]  # [tx, chirp_loop, rx, adc]


def _get_or_create_radar_sensor(frame_raw):
    """Cache one RadarSensor — its config is fixed by OUTPUT_BIN_CONFIG."""
    global _radar_sensor_cache
    with _radar_sensor_lock:
        if _radar_sensor_cache is None:
            _radar_sensor_cache = RadarSensor(frame_raw)
        return _radar_sensor_cache


# --------------------------------------------------
# Sensor fusion: associate radar detections to YOLO bboxes
# --------------------------------------------------
def associate_radar_to_yolo(radar_dets, yolo_dets):
    """
    Match radar detections to YOLO bboxes by range only. The phased-array
    az/el estimate on this hardware is too noisy to use for spatial
    association, so we pair by rank: highest-confidence YOLO detection gets
    the closest-range radar detection, next-highest gets the next-closest,
    and so on. Extra radar (more radar than camera) stays unmatched and
    shows up in unmatched_radar; extra camera detections show up in
    unmatched_camera with no radar info attached.

    Mutates `radar_dets` in place, setting each entry's "associated" field
    to either a match dict or None.
    """
    for r in radar_dets:
        r["associated"] = None

    if not radar_dets or not yolo_dets:
        return radar_dets

    # Rank radar by ascending range (closest first) and YOLO by descending
    # confidence (most-confident first), then pair them position-for-position.
    radar_order = sorted(
        range(len(radar_dets)),
        key=lambda i: radar_dets[i]["range_m"],
    )
    yolo_order = sorted(
        range(len(yolo_dets)),
        key=lambda i: -yolo_dets[i]["confidence"],
    )

    for y_idx, r_idx in zip(yolo_order, radar_order):
        y = yolo_dets[y_idx]
        radar_dets[r_idx]["associated"] = {
            "yolo_idx": y_idx,
            "label": y["label"],
            "confidence": y["confidence"],
            "bbox": y["bbox"],
            "match_type": "range_only",
        }

    return radar_dets


def generate_range_doppler_heatmap(radar_buf, yolo_dets=None):
    """
    Returns (PIL.Image, list[radar_detection_dict]).

    Each radar detection carries: range_m, velocity_mps, az_deg, el_deg,
    range_bin, doppler_bin, and — if yolo_dets was supplied — an "associated"
    field linking it to the matching YOLO bbox (or None).

    Returns (None, []) on failure.
    """
    if radar_buf is None or len(radar_buf) == 0:
        return None, []

    try:
        frame_raw = _unpack_radar_buf_to_frame(radar_buf)
        if frame_raw is None:
            return None, []

        radar = _get_or_create_radar_sensor(frame_raw)

        # Range-FFT + Doppler-FFT.
        #   range_cube: [adc, tx, rx, loop]
        #   rd_cube:    [range, tx, rx, doppler]
        range_cube, rd_cube = radar.process_tdm_mimo_cube(frame_raw)

        # Trim to [MIN_RANGE, MAX_RANGE].
        if MAX_RANGE is None or MIN_RANGE is None:
            rd_cube_trimmed = rd_cube
            plot_range_axis = radar.range_axis
        else:
            rd_cube_trimmed, plot_range_axis = radar.get_range_azimuth_subset(
                rd_cube, MIN_RANGE, MAX_RANGE
            )
            radar.range_axis = plot_range_axis

        detection_pairs = radar.detect_targets_2d(
            rd_cube_trimmed,
            range_threshold_db=RANGE_CFAR_THRESHOLD_DB,
            doppler_threshold_db=DOPPLER_CFAR_THRESHOLD_DB,
        )

        # Per-detection angle estimate. phased_array_aoa prints a lot; mute it
        # the same way helena_getframes does. We still compute radar az/el and
        # keep it on the detection dict (as radar_az_deg / radar_el_deg in the
        # fused outputs) for reference — but the angle we actually REPORT for
        # each detected object comes from the camera (YOLO bbox center).
        detection_list = []
        with contextlib.redirect_stdout(io.StringIO()):
            for r_idx, d_idx in detection_pairs:
                try:
                    az_deg, el_deg = radar.phased_array_aoa(range_cube, r_idx, d_idx)
                except Exception:
                    az_deg, el_deg = 0.0, 0.0

                detection_list.append({
                    "range_bin": int(r_idx),
                    "doppler_bin": int(d_idx),
                    "range_m": float(plot_range_axis[r_idx]),
                    "velocity_mps": float(radar.velocity_axis[d_idx]),
                    "az_deg": float(az_deg),
                    "el_deg": float(el_deg),
                    "associated": None,
                })

        # Associate with YOLO bboxes (if camera detections are available).
        if yolo_dets:
            associate_radar_to_yolo(detection_list, yolo_dets)

        # Heatmap in dB (TX/RX-summed power).
        rd_power = np.sum(np.abs(rd_cube_trimmed) ** 2, axis=(1, 2))
        rd_db = 10.0 * np.log10(rd_power + EPSILON)

        fig, ax = plt.subplots(figsize=(8, 5), constrained_layout=True)
        ax.pcolormesh(
            radar.velocity_axis,
            plot_range_axis,
            rd_db,
            shading="auto",
            cmap="viridis",
            vmin=np.max(rd_db) - 40.0,
            vmax=np.max(rd_db),
        )

        # Overlay detections: lime = associated to a camera bbox, red = unmatched.
        for det in detection_list:
            color = "lime" if det["associated"] is not None else "red"
            ax.plot(
                det["velocity_mps"],
                det["range_m"],
                marker="o",
                color=color,
                markersize=5,
                markeredgecolor="white",
                markeredgewidth=0.5,
            )
            if det["associated"] is not None:
                ax.annotate(
                    det["associated"]["label"],
                    (det["velocity_mps"], det["range_m"]),
                    textcoords="offset points",
                    xytext=(6, 4),
                    color="white",
                    fontsize=8,
                )

        ax.set_xlim(-10, 10)
        if MIN_RANGE is not None and MAX_RANGE is not None:
            ax.set_ylim(MIN_RANGE, MAX_RANGE)
        ax.set_xlabel("Velocity (m/s)")
        ax.set_ylabel("Range (m)")

        n_matched = sum(1 for d in detection_list if d["associated"] is not None)
        ax.set_title(
            f"Range-Doppler | Detections: {len(detection_list)} "
            f"(matched to camera: {n_matched})"
        )

        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=100, bbox_inches="tight")
        plt.close(fig)
        buffer.seek(0)
        return Image.open(buffer).copy(), detection_list

    except Exception as e:
        print(f"ERROR generating range-doppler heatmap: {e}")
        traceback.print_exc()
        return None, []


@app.route("/api/range-doppler")
def get_range_doppler():
    """
    Range-Doppler heatmap (base64 PNG) + CFAR detections, each annotated with
    the associated YOLO label if one was found.
    """
    global latest_radar_detections

    with state_lock:
        radar_buf = latest_radar_buf
        timestamp = latest_timestamp
        yolo_dets_snapshot = list(current_detections)

    if radar_buf is None:
        return jsonify({"error": "No radar data available", "image": None}), 204

    img, detection_list = generate_range_doppler_heatmap(
        radar_buf, yolo_dets=yolo_dets_snapshot
    )

    if img is None:
        return jsonify({"error": "Failed to generate heatmap", "image": None}), 500

    with state_lock:
        latest_radar_detections = detection_list

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    img_base64 = base64.b64encode(buffer.getvalue()).decode()

    return jsonify({
        "timestamp": timestamp,
        "image": img_base64,
        "format": "base64",
        "num_detections": len(detection_list),
        "num_matched": sum(1 for d in detection_list if d["associated"] is not None),
        "detections": detection_list,
    })


@app.route("/api/fused-detections")
def get_fused_detections():
    """
    Pure-JSON sensor-fusion endpoint (no image). Re-runs radar processing on
    the latest radar buffer and associates against the latest YOLO bboxes.
    Each association entry combines camera info (label/bbox) with radar
    info (range/velocity) plus the projected radar pixel — handy for
    overlaying a dot on the webcam feed.

    Angle convention: az_deg / el_deg on each association come from the
    CAMERA (YOLO bbox center projected through the pinhole model). The
    radar's phased_array_aoa estimate is preserved as radar_az_deg /
    radar_el_deg for reference only.
    """
    with state_lock:
        radar_buf = latest_radar_buf
        timestamp = latest_timestamp
        yolo_dets_snapshot = list(current_detections)

    if radar_buf is None:
        return jsonify({
            "timestamp": timestamp,
            "associations": [],
            "unmatched_radar": [],
            "unmatched_camera": [_camera_only_entry(y) for y in yolo_dets_snapshot],
        })

    _, detection_list = generate_range_doppler_heatmap(
        radar_buf, yolo_dets=yolo_dets_snapshot
    )

    associations = []
    matched_yolo_idxs = set()
    unmatched_radar = []

    for det in detection_list:
        if det["associated"] is not None:
            y_idx = det["associated"]["yolo_idx"]
            matched_yolo_idxs.add(y_idx)
            yolo_entry = yolo_dets_snapshot[y_idx]

            # Camera-derived angle + pixel for this object. az_deg/el_deg on
            # the yolo_entry are the bbox-center angles computed in
            # run_yolo_on_frame; projected_pixel is simply the bbox center.
            bx, by, bw, bh = yolo_entry["bbox"]
            cam_px = bx + bw / 2.0
            cam_py = by + bh / 2.0

            associations.append({
                "label": yolo_entry["label"],
                "confidence": yolo_entry["confidence"],
                "bbox": yolo_entry["bbox"],
                "image_size": [yolo_entry["img_w"], yolo_entry["img_h"]],
                "projected_pixel": [cam_px, cam_py],
                "range_m": det["range_m"],
                "velocity_mps": det["velocity_mps"],
                # Camera-derived angles (bbox center).
                "az_deg": yolo_entry["az_deg"],
                "el_deg": yolo_entry["el_deg"],
                # Radar-derived angles kept for reference / debugging.
                "radar_az_deg": det["az_deg"],
                "radar_el_deg": det["el_deg"],
                "range_bin": det["range_bin"],
                "doppler_bin": det["doppler_bin"],
            })
        else:
            unmatched_radar.append(det)

    unmatched_camera = [
        _camera_only_entry(y)
        for i, y in enumerate(yolo_dets_snapshot)
        if i not in matched_yolo_idxs
    ]

    return jsonify({
        "timestamp": timestamp,
        "associations": associations,
        "unmatched_radar": unmatched_radar,
        "unmatched_camera": unmatched_camera,
    })


# --------------------------------------------------
# Synchronized snapshot — camera + radar + fusion, all from the same frame
# --------------------------------------------------
# Cache keyed by frame sequence number — bumped monotonically by
# sensor_callback, so it changes for every new frame regardless of how the
# SDK reports timestamps (coarse integers, reused values, etc.).
_snapshot_cache = {"seq": None, "rd_image": None, "detection_list": None}
_snapshot_cache_lock = threading.Lock()


def _get_processed_snapshot(radar_buf, yolo_dets, seq):
    """Process the radar buf once per frame sequence; reuse on repeat calls."""
    with _snapshot_cache_lock:
        if seq is not None and _snapshot_cache["seq"] == seq:
            return _snapshot_cache["rd_image"], _snapshot_cache["detection_list"]

    rd_image, detection_list = generate_range_doppler_heatmap(
        radar_buf, yolo_dets=yolo_dets
    )
    detection_list = detection_list or []

    with _snapshot_cache_lock:
        _snapshot_cache["seq"] = seq
        _snapshot_cache["rd_image"] = rd_image
        _snapshot_cache["detection_list"] = detection_list
    return rd_image, detection_list


def _camera_only_entry(yolo_entry):
    """
    Shape a YOLO detection into the same schema associations use, with a
    guaranteed top-level az_deg / el_deg (camera-derived, bbox center) and
    radar fields explicitly set to None. This means every camera detection —
    matched to radar or not — carries an azimuth, and clients can iterate
    associations and unmatched_camera with identical key assumptions.
    """
    bx, by, bw, bh = yolo_entry["bbox"]
    cam_px = bx + bw / 2.0
    cam_py = by + bh / 2.0
    return {
        "label": yolo_entry["label"],
        "confidence": yolo_entry["confidence"],
        "bbox": yolo_entry["bbox"],
        "image_size": [yolo_entry["img_w"], yolo_entry["img_h"]],
        "projected_pixel": [cam_px, cam_py],
        # Camera-derived angles, always present.
        "az_deg": yolo_entry["az_deg"],
        "el_deg": yolo_entry["el_deg"],
        "az_min_deg": yolo_entry.get("az_min_deg"),
        "az_max_deg": yolo_entry.get("az_max_deg"),
        "el_min_deg": yolo_entry.get("el_min_deg"),
        "el_max_deg": yolo_entry.get("el_max_deg"),
        # No radar for this detection.
        "range_m": None,
        "velocity_mps": None,
        "radar_az_deg": None,
        "radar_el_deg": None,
        "range_bin": None,
        "doppler_bin": None,
    }


def _build_association_buckets(detection_list, yolo_dets):
    """
    Split radar detection list into (associations, unmatched_radar,
    unmatched_camera).

    Angle convention in the association output: az_deg / el_deg are the
    CAMERA-derived angles (bbox center through pinhole model). The radar's
    phased_array_aoa estimate is retained as radar_az_deg / radar_el_deg
    for reference.
    """
    associations = []
    matched_yolo_idxs = set()
    unmatched_radar = []

    for det in detection_list:
        if det.get("associated") is not None:
            y_idx = det["associated"]["yolo_idx"]
            matched_yolo_idxs.add(y_idx)
            y = yolo_dets[y_idx]

            # projected_pixel is the bbox center — matches the camera angle.
            bx, by, bw, bh = y["bbox"]
            cam_px = bx + bw / 2.0
            cam_py = by + bh / 2.0

            associations.append({
                "label": y["label"],
                "confidence": y["confidence"],
                "bbox": y["bbox"],
                "image_size": [y["img_w"], y["img_h"]],
                "projected_pixel": [cam_px, cam_py],
                "range_m": det["range_m"],
                "velocity_mps": det["velocity_mps"],
                # Camera-derived angles (from YOLO bbox center).
                "az_deg": y["az_deg"],
                "el_deg": y["el_deg"],
                # Radar-derived angles kept for reference / debugging.
                "radar_az_deg": det["az_deg"],
                "radar_el_deg": det["el_deg"],
                "range_bin": det["range_bin"],
                "doppler_bin": det["doppler_bin"],
            })
        else:
            unmatched_radar.append(det)

    unmatched_camera = [
        _camera_only_entry(y)
        for i, y in enumerate(yolo_dets)
        if i not in matched_yolo_idxs
    ]
    return associations, unmatched_radar, unmatched_camera


@app.route("/api/snapshot")
def get_snapshot():
    """
    Single synchronized frame: camera JPEG + RD heatmap + fused detections,
    all derived from the same sensor_callback invocation. Poll this instead
    of the individual endpoints so the webcam feed, RD map, and detections
    list are guaranteed to show the same frame.
    """
    # Atomic read of everything the callback wrote together.
    with state_lock:
        camera_jpeg = latest_camera_jpeg
        radar_buf = latest_radar_buf
        yolo_dets = list(current_detections)
        ts = latest_timestamp
        seq = latest_frame_seq

    if camera_jpeg is None or radar_buf is None:
        return jsonify({"error": "Sensors not ready", "timestamp": ts}), 204

    rd_image, detection_list = _get_processed_snapshot(radar_buf, yolo_dets, seq)

    associations, unmatched_radar, unmatched_camera = _build_association_buckets(
        detection_list, yolo_dets
    )

    # Encode camera JPEG as base64 (instead of streaming MJPEG separately).
    camera_b64 = base64.b64encode(camera_jpeg).decode()

    if rd_image is not None:
        rd_buf = io.BytesIO()
        rd_image.save(rd_buf, format="PNG")
        rd_b64 = base64.b64encode(rd_buf.getvalue()).decode()
        rd_format = "png"
    else:
        rd_b64 = None
        rd_format = None

    return jsonify({
        "timestamp": ts,
        "camera_image": camera_b64,
        "camera_format": "jpeg",
        "range_doppler_image": rd_b64,
        "range_doppler_format": rd_format,
        "num_matched": len(associations),
        "num_radar_only": len(unmatched_radar),
        "num_camera_only": len(unmatched_camera),
        "associations": associations,
        "unmatched_radar": unmatched_radar,
        "unmatched_camera": unmatched_camera,
    })


# start background interface once on server startup
start_sensor_interface()

if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0", use_reloader=False)