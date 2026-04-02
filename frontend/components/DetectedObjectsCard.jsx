"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { DetectedObjectNotification } from "@/components/ui/DetectedObjectNotification";

function getIcon(label) {
  const lower = label.toLowerCase();

  if (lower.includes("person")) return "🚶";
  if (
    lower.includes("car") ||
    lower.includes("vehicle") ||
    lower.includes("truck")
  ) {
    return "🚗";
  }
  if (lower.includes("bike") || lower.includes("bicycle")) return "🚴";
  return "📦";
}

function getRiskLevel(confidence) {
  if (confidence > 0.8) return "High";
  if (confidence > 0.6) return "Medium";
  return "Low";
}

export default function DetectedObjectsCard() {
  const [detections, setDetections] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch("http://127.0.0.1:5001/api/detections")
        .then((r) => r.json())
        .then((data) => {
          setDetections(data.detections ?? []);
        })
        .catch((e) => console.error("Failed to fetch detections:", e));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
          Detected Objects ({detections.length})
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {detections.length === 0 ? (
          <div className="text-xs text-white/50">No objects detected</div>
        ) : (
          detections.map((det, idx) => (
            <DetectedObjectNotification
              key={idx}
              icon={getIcon(det.label)}
              object={det.label}
              distance="-"
              speed="-"
              angle="-"
              riskLevel={getRiskLevel(det.confidence)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

