from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Enable CORS for all routes (necessary for local development)


# Your API will be accessible at http://localhost:5000/api/data. 
@app.route("/api/data")
def get_data():
    return jsonify({
        "name": "Next.js + Flask",
        "message": "Hello from the Flask backend!"
    })

if __name__ == "__main__":
    # Run the app on port 5000
    app.run(debug=True, port=5000)
