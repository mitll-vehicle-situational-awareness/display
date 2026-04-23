"use client";

import LiveWebcamCard from "@/components/LiveWebcamCard";
import RadarDisplayCard from "@/components/RadarDisplayCard";
import RangeDopplerCard from "@/components/RangeDopplerCard";
import DetectedObjectsCard from "@/components/DetectedObjectsCard";
import { SnapshotProvider } from "@/components/SnapshotContext";

export default function Home() {
  return (
    <SnapshotProvider intervalMs={250}>
      <div className="min-h-screen bg-[#070B14] text-white">
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          <div className="flex gap-6">
            <div className="w-2/3">
              <LiveWebcamCard />
            </div>

            <div className="w-1/3 flex flex-col gap-6">
              <RangeDopplerCard />
              <DetectedObjectsCard />
            </div>
          </div>
        </div>
      </div>
    </SnapshotProvider>
  );
}