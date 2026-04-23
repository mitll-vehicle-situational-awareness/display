"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useMemo } from "react";
import { DetectedObjectNotification } from "@/components/DetectedObjectNotification";
import { useSnapshot } from "@/components/SnapshotContext";

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
  if (lower === "unknown") return "📡"; // radar-only, no camera label
  return "📦";
}

// If we have a YOLO confidence, use that. Otherwise (radar-only) fall back
// to proximity — closer targets are higher risk.
function getRiskLevel(confidence, rangeM) {
  if (confidence != null) {
    if (confidence > 0.8) return "High";
    if (confidence > 0.6) return "Medium";
    return "Low";
  }
  if (rangeM != null) {
    if (rangeM < 1.0) return "High";
    if (rangeM < 2.0) return "Medium";
    return "Low";
  }
  return "Low";
}

const fmtDistance = (m) => (m == null ? "-" : `${m.toFixed(2)} m`);
const fmtSpeed = (v) => (v == null ? "-" : `${v.toFixed(2)} m/s`);
const fmtAngle = (a) => (a == null ? "-" : `${a.toFixed(1)}°`);

export default function DetectedObjectsCard() {
  const { snapshot } = useSnapshot();

  const items = useMemo(() => {
    if (!snapshot) return [];

    const fused = (snapshot.associations ?? []).map((d, i) => ({
      key: `fused-${i}`,
      source: "fused",
      label: d.label,
      confidence: d.confidence,
      range_m: d.range_m,
      velocity_mps: d.velocity_mps,
      az_deg: d.az_deg,
    }));

    const cameraOnly = (snapshot.unmatched_camera ?? []).map((d, i) => ({
      key: `cam-${i}`,
      source: "camera",
      label: d.label,
      confidence: d.confidence,
      range_m: null,
      velocity_mps: null,
      az_deg: null,
    }));

    const radarOnly = (snapshot.unmatched_radar ?? []).map((d, i) => ({
      key: `rad-${i}`,
      source: "radar",
      label: "Unknown",
      confidence: null,
      range_m: d.range_m,
      velocity_mps: d.velocity_mps,
      az_deg: d.az_deg,
    }));

    return [...fused, ...cameraOnly, ...radarOnly];
  }, [snapshot]);

  return (
    <Card className="flex h-[42vh] flex-col rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
          Detected Objects ({items.length})
        </CardTitle>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 pr-1">
          {items.length === 0 ? (
            <div className="text-xs text-white/50">No objects detected</div>
          ) : (
            items.map((det) => (
              <DetectedObjectNotification
                key={det.key}
                icon={getIcon(det.label)}
                object={det.label}
                distance={fmtDistance(det.range_m)}
                speed={fmtSpeed(det.velocity_mps)}
                angle={fmtAngle(det.az_deg)}
                riskLevel={getRiskLevel(det.confidence, det.range_m)}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}