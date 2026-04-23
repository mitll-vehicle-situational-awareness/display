"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useSnapshot,
  useSnapshotImages,
} from "@/components/SnapshotContext";

export default function LiveWebcamCard() {
  const { isLive } = useSnapshot();
  const { cameraSrc } = useSnapshotImages();

  return (
    <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      <div className="px-4 pt-4">
        <div className="mb-3 flex items-center justify-between text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isLive ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span>{isLive ? "LIVE" : "IDLE"}</span>
          </div>
          <div>Front Camera — 1920×1080</div>
        </div>

        <div className="relative h-[78vh] overflow-hidden rounded-xl border border-white/10 bg-black">
          {cameraSrc ? (
            <img
              src={cameraSrc}
              alt="Live webcam"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
              Waiting for camera feed…
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-[#0B1221]/20 via-transparent to-black/30" />

          {/* <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-3">
            <Button variant="destructive">● Stop Recording</Button>
            <Button variant="secondary" disabled>
              Save Recording
            </Button>
          </div> */}
        </div>
      </div>
    </Card>
  );
}