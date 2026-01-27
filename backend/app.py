from flask import Flask, jsonify, request
from flask_cors import CORS
import csv
import os

app = Flask(__name__)
CORS(app)

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

# Keep a simple sanity endpoint
@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from the Flask backend!"})

# ✅ FIXED: /api/data now returns radar points
@app.route("/api/data")
def get_data():
    file_param = request.args.get("file", "1")
    filename, csv_path = resolve_csv_path(file_param)

    if not os.path.exists(csv_path):
        return jsonify({"error": f"CSV not found: {filename}"}), 404

    points = read_points_from_csv(csv_path)
    return jsonify({"file": filename, "count": len(points), "points": points})

# Optional: keep /api/radar-points as an alias (nice for clarity)
@app.route("/api/radar-points")
def radar_points_alias():
    return get_data()

if __name__ == "__main__":
    app.run(debug=True, port=5000, host="0.0.0.0")
