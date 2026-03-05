import cv2
import numpy as np

# Load YOLOv8 ONNX model
net = cv2.dnn.readNet("yolov8n.onnx")

# Use CPU
net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

# Load class names
with open("coco.names", "r") as f:
    class_names = [line.strip() for line in f.readlines()]

# Open camera
cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Convert frame to blob (YOLO expects this)
    blob = cv2.dnn.blobFromImage(frame, 1/255.0, (640, 640), swapRB=True, crop=False)
    net.setInput(blob)

    # Forward pass
    outputs = net.forward(net.getUnconnectedOutLayersNames())

    # Post-process outputs to extract boxes, confidences, and classes
    boxes = []
    confidences = []
    class_ids = []
    
    # YOLOv8 output format: (1, 84, 8400)
    # 84 = 4 box coordinates + 80 class probabilities
    output = outputs[0].transpose()
    
    for detection in output:
        # Extract box coordinates and confidence scores
        box_coords = detection[:4]
        class_scores = detection[4:]
        
        # Get the class with highest confidence
        confidence = np.max(class_scores)
        class_id = np.argmax(class_scores)
        
        # Filter by confidence threshold
        if confidence > 0.5:
            # Convert from center coordinates to corner coordinates
            center_x = int(box_coords[0] * frame.shape[1])
            center_y = int(box_coords[1] * frame.shape[0])
            width = int(box_coords[2] * frame.shape[1])
            height = int(box_coords[3] * frame.shape[0])
            
            x1 = center_x - width // 2
            y1 = center_y - height // 2
            
            boxes.append([x1, y1, width, height])
            confidences.append(float(confidence))
            class_ids.append(class_id)
    
    # Apply Non-Maximum Suppression
    indices = cv2.dnn.NMSBoxes(boxes, confidences, 0.5, 0.4)
    
    # Draw boxes on frame
    for i in indices:
        i = i[0] if isinstance(i, np.ndarray) else i
        box = boxes[i]
        confidence = confidences[i]
        class_id = class_ids[i]
        
        x1, y1, w, h = box
        x2, y2 = x1 + w, y1 + h
        
        # Draw rectangle
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        
        # Draw label
        class_name = class_names[class_id]
        label = f"{class_name}: {confidence:.2f}"
        cv2.putText(frame, label, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

    cv2.imshow("YOLO ONNX", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()