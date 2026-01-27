"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";

import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type Point = { x: number; y: number };
interface ApiData {
  points: Point[];
}

export default function Home() {
  const [p1, setP1] = useState<Point[]>([]);
  const [p2, setP2] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState<1 | 2>(1);

  // Load both CSV snapshots
  useEffect(() => {
    Promise.all([
      fetch("http://127.0.0.1:5001/api/data?file=1").then(
        (r) => r.json() as Promise<ApiData>
      ),
      fetch("http://127.0.0.1:5001/api/data?file=2").then(
        (r) => r.json() as Promise<ApiData>
      ),
    ])
      .then(([d1, d2]) => {
        setP1(d1.points ?? []);
        setP2(d2.points ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setIsLoading(false);
      });
  }, []);

  // Flip animation
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFrame((f) => (f === 1 ? 2 : 1));
    }, 700);
    return () => clearInterval(id);
  }, [playing]);

  const displayPoints = frame === 1 ? p1 : p2;

  // Fixed axis domains
  const { xDomain, yDomain } = useMemo(() => {
    const all = [...p1, ...p2];
    if (all.length === 0) return { xDomain: [0, 1], yDomain: [0, 1] };

    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const pad = 0.25;

    return {
      xDomain: [Math.min(...xs) - pad, Math.max(...xs) + pad] as [number, number],
      yDomain: [Math.min(...ys) - pad, Math.max(...ys) + pad] as [number, number],
    };
  }, [p1, p2]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070B14] text-zinc-200">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070B14] text-zinc-100">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="flex gap-6">
          {/* LEFT: Camera panel */}
          <div className="w-2/3">
            <Card className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              {/* Top overlay */}
              <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3 text-xs text-white/80">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>LIVE</span>
                </div>
                <div>Front Camera — 1920×1080 @ 60fps</div>
              </div>

              {/* Camera placeholder */}
              <div className="relative h-[78vh]">
                <div className="absolute inset-0 bg-gradient-to-b from-[#0B1221] via-[#070B14] to-black" />

                {/* Grid */}
                <div
                  className="absolute inset-0 opacity-[0.16]"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(255,255,255,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.10) 1px, transparent 1px)",
                    backgroundSize: "72px 72px",
                  }}
                />

                {/* Crosshair */}
                <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/50">
                  <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-sky-300/30" />
                  <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-sky-300/30" />
                </div>

                <div className="absolute bottom-6 left-6 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 backdrop-blur">
                  Camera visualization goes here
                </div>

                {/* Bottom controls */}
                <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-3">
                  <Button variant="destructive">● Stop Recording</Button>
                  <Button variant="secondary" disabled>
                    Save Recording
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* RIGHT column */}
          <div className="w-1/3 flex flex-col gap-6">
            {/* Radar panel */}
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                  Radar Data (2D)
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs text-white/60">
                    Showing: detected_positions{frame === 1 ? "" : "2"}.csv
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? "Pause" : "Play"}
                  </Button>
                </div>

                <div className="h-[32vh] rounded-xl border border-white/10 bg-[#060B15] p-2">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        domain={xDomain}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                        tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        domain={yDomain}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                        tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(v) => Number(v).toFixed(2)}
                        contentStyle={{
                          background: "rgba(10, 15, 30, 0.95)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 12,
                          color: "#FFFFFF", // ← THIS makes hover text white
                        }}
                      />
                      <Scatter data={displayPoints} fill="#7CFFB2" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 flex justify-between text-[11px] text-white/50">
                  <div>Points: {displayPoints.length}</div>
                  <div>Depth: 0–40m</div>
                </div>
              </CardContent>
            </Card>

            {/* Detected objects */}
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                  Detected Objects
                </CardTitle>
              </CardHeader>
              <CardContent className="text-white/60">
                Object metadata will appear here
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
