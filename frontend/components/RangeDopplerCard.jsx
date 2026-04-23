"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  useSnapshot,
  useSnapshotImages,
} from "@/components/SnapshotContext";

export default function RangeDopplerCard() {
  const { snapshot, isLive } = useSnapshot();
  const { rdSrc } = useSnapshotImages();

  const timestamp = snapshot?.timestamp ?? null;

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
            {timestamp
              ? `Last update: ${new Date(timestamp * 1000).toLocaleTimeString()}`
              : "Initializing..."}
          </div>
          <div className="flex gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                isLive ? "bg-emerald-400" : "bg-red-400"
              } animate-pulse`}
            />
            <span className="text-xs text-white/60">
              {isLive ? "LIVE" : "IDLE"}
            </span>
          </div>
        </div>

        <div className="relative flex h-[32vh] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#060B15]">
          {rdSrc ? (
            <img
              src={rdSrc}
              alt="Range-Doppler Heatmap"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-center text-sm text-white/60">
              Loading range-doppler data...
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}