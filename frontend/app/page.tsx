"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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

  // Load both snapshots once
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

  // Fixed axis domains (from both datasets)
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
      {/* Outer padding like the mock */}
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="flex gap-6">
          {/* LEFT: Camera panel */}
          <div className="w-2/3">
            <Card className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              {/* Top overlay bar */}
              <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3 text-xs text-white/80">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="tracking-wide">LIVE</span>
                </div>
                <div className="tracking-wide">Front Camera — 1920×1080 @ 60fps</div>
              </div>

              {/* “Video” area */}
              <div className="relative h-[78vh]">
                {/* Background gradient to mimic video darkening */}
                <div className="absolute inset-0 bg-gradient-to-b from-[#0B1221] via-[#070B14] to-black" />

                {/* Subtle grid overlay */}
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

                {/* Placeholder label */}
                <div className="absolute bottom-6 left-6 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80 backdrop-blur">
                  Camera visualization goes here
                </div>

                {/* Bottom controls like the mock */}
                <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-3">
                  <button className="rounded-xl bg-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(244,63,94,0.35)]">
                    ● Stop Recording
                  </button>
                  <button className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/50">
                    Save Recording
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* RIGHT: Panels */}
          <div className="w-1/3 flex flex-col gap-6">
            {/* Radar Point Cloud */}
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                  Radar Data (2D)
                </CardTitle>
              </CardHeader>

              <CardContent>
                {/* Controls row */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs text-white/60">
                    Showing: detected_positions{frame === 1 ? "" : "2"}.csv
                  </div>

                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                </div>

                {/* Radar panel */}
                <div className="h-[32vh] w-full rounded-xl border border-white/10 bg-[#060B15] p-2">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        domain={xDomain}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                        tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.12)" }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        domain={yDomain}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                        tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.12)" }}
                      />
                      <Tooltip
                        formatter={(v) => Number(v).toFixed(2)}
                        contentStyle={{
                          background: "rgba(10, 15, 30, 0.95)",
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 12,
                          color: "rgba(255,255,255,0.85)",
                        }}
                        labelStyle={{ color: "rgba(255,255,255,0.55)" }}
                      />
                      <Scatter
                        data={displayPoints}
                        fill="#7CFFB2" // radar-ish green
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-white/50">
                  <div>Points: {displayPoints.length}</div>
                  <div>Depth: 0–40m</div>
                </div>
              </CardContent>
            </Card>

            {/* Detected Objects */}
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                    Detected Objects
                  </CardTitle>
                  <div className="text-xs text-white/60">Real-time</div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Placeholder rows to match the vibe */}
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-rose-300">Pedestrian</div>
                    <div className="text-xs font-semibold text-rose-300/80">HIGH</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/65">
                    <div>Distance: 8.5m</div>
                    <div>Speed: 1 km/h</div>
                    <div>Angle: +35°</div>
                    <div>Conf: 88%</div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-rose-500/20">
                    <div className="h-1.5 w-[88%] rounded-full bg-rose-400" />
                  </div>
                </div>

                <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-amber-200">Car</div>
                    <div className="text-xs font-semibold text-amber-200/80">MEDIUM</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/65">
                    <div>Distance: 18.3m</div>
                    <div>Speed: 50 km/h</div>
                    <div>Angle: -2°</div>
                    <div>Conf: 95%</div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-amber-400/20">
                    <div className="h-1.5 w-[95%] rounded-full bg-amber-300" />
                  </div>
                </div>

                <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-amber-200">Car</div>
                    <div className="text-xs font-semibold text-amber-200/80">MEDIUM</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/65">
                    <div>Distance: 12.5m</div>
                    <div>Speed: 45 km/h</div>
                    <div>Angle: -4°</div>
                    <div>Conf: 94%</div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-amber-400/20">
                    <div className="h-1.5 w-[94%] rounded-full bg-amber-300" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* (Optional) third panel if you want later */}
          </div>
        </div>
      </div>
    </div>
  );
}
