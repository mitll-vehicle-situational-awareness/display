"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LiveWebcamCard() {
  return (
    <Card className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3 text-xs text-white/80">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>LIVE</span>
        </div>
        <div>Front Camera — 1920×1080</div>
      </div>

      <div className="relative h-[78vh]">
        <img
          src="http://10.5.8.16:5001/api/webcam"
          alt="Live webcam"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B1221]/30 via-[#070B14]/30 to-black/40" />

        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-3">
          <Button variant="destructive">● Stop Recording</Button>
          <Button variant="secondary" disabled>
            Save Recording
          </Button>
        </div>
      </div>
    </Card>
  );
}
