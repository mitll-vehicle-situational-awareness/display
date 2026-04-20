"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useEffect, useState, useRef } from "react";

export default function RangeDopplerCard() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timestamp, setTimestamp] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  // Fetch range-doppler heatmap from backend
  const fetchRangeDoppler = async () => {
    try {
      const response = await fetch(`http://${window.location.hostname}:5001/api/range-doppler`);
      
      if (!response.ok) {
        if (response.status === 204) {
          setError("No radar data available");
          return;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.image) {
        setImageSrc(`data:image/png;base64,${data.image}`);
        setTimestamp(data.timestamp);
        setError(null);
      } else {
        setError("No image data received");
      }
      
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to fetch range-doppler:", err);
      setError(`Error: ${err.message}`);
      setIsLoading(false);
    }
  };

  // Auto-adjust hostname if accessed from different host
  useEffect(() => {
    // Initial fetch
    fetchRangeDoppler();

    // Set up auto-refresh every 500ms for live data
    intervalRef.current = setInterval(() => {
      fetchRangeDoppler();
    }, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
          Range-Doppler Map
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs text-white/60">
            {timestamp ? `Last update: ${new Date(timestamp * 1000).toLocaleTimeString()}` : "Initializing..."}
          </div>
          <div className="flex gap-2">
            <div className={`h-2 w-2 rounded-full ${imageSrc ? "bg-emerald-400" : "bg-red-400"} animate-pulse`} />
            <span className="text-xs text-white/60">
              {imageSrc ? "LIVE" : "IDLE"}
            </span>
          </div>
        </div>

        <div className="relative h-[32vh] rounded-xl border border-white/10 bg-[#060B15] overflow-hidden flex items-center justify-center">
          {isLoading && !imageSrc && (
            <div className="text-center text-white/60 text-sm">
              Loading range-doppler data...
            </div>
          )}

          {error && !imageSrc && (
            <div className="text-center text-red-400/70 text-sm px-4">
              {error}
            </div>
          )}

          {imageSrc && (
            <img
                src={imageSrc}
                alt="Range-Doppler Heatmap"
                className="w-full h-full object-contain"
            />
            )}
        </div>

      
      </CardContent>
    </Card>
  );
}
