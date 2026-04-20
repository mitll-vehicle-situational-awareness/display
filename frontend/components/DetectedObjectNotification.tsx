interface DetectedObjectNotificationProps {
  icon: string;
  object: string;
  distance: string;
  speed: string;
  angle: string;
  riskLevel: "Low" | "Medium" | "High";
}

export function DetectedObjectNotification({
  icon,
  object,
  distance,
  speed,
  angle,
  riskLevel,
}: DetectedObjectNotificationProps) {
  // Determine risk level styling
  const riskColors = {
    High: "bg-red-500/20 border-red-500/50 text-red-400",
    Medium: "bg-yellow-500/20 border-yellow-500/50 text-yellow-400",
    Low: "bg-green-500/20 border-green-500/50 text-green-400",
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#060B15] p-3">
      <div className="flex items-center gap-3">
        <div className="text-2xl">{icon}</div>
        <div>
          <div className="text-sm font-semibold text-white">{object}</div>
          <div className="text-xs text-white/50">
            {distance} • {speed} • {angle}
          </div>
        </div>
      </div>
      <div
        className={`rounded-md border px-2 py-1 text-xs font-medium ${riskColors[riskLevel]}`}
      >
        {riskLevel}
      </div>
    </div>
  );
}