from flask import Flask, jsonify, request
from flask_cors import CORS
import csv
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes (necessary for local development)

# ---------------------------
# Existing test endpoint
# ---------------------------
@app.route("/api/data")
def get_data():
    return jsonify({
        "name": "Next.js + Flask",
        "message": "Hello from the Flask backend!"
    })


# ---------------------------
# NEW: Radar CSV endpoint
# ---------------------------
def read_points_from_csv(csv_path):
    points = []

    with open(csv_path, "r", newline="") as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                x = float(row["detected_x"])
                y = float(row["detected_y"])
                points.append({"x": x, "y": y})
            except (KeyError, ValueError):
                # Skip rows with missing or invalid data
                continue

    return points


@app.route("/api/radar-points")
def radar_points():
    # ?file=1 or ?file=2
    file_param = request.args.get("file", "1")

    filename = (
        "detected_positions2.csv"
        if file_param == "2"
        else "detected_positions.csv"
    )

    # CSVs are in repo root (same level as backend/)
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    csv_path = os.path.join(repo_root, filename)

    if not os.path.exists(csv_path):
        return jsonify({"error": f"CSV not found: {filename}"}), 404

    points = read_points_from_csv(csv_path)

    return jsonify({
        "file": filename,
        "count": len(points),
        "points": points
    })


if __name__ == "__main__":
    # Run the app on port 5000
    app.run(debug=True, port=5000)
