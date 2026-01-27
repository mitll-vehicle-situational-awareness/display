"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useState, useEffect } from "react";

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
  count: number;
  file: string;
  points: Point[];
}

export default function Home() {
  const [p1, setP1] = useState<Point[]>([]);
  const [p2, setP2] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<"flip" | "smooth">("smooth");
  const [frame, setFrame] = useState<1 | 2>(1); // flip mode
  const [t, setT] = useState(0); // smooth mode 0..1

  // Load both snapshots once
  useEffect(() => {
    Promise.all([
      fetch("http://localhost:5001/api/data?file=1").then((r) => r.json() as Promise<ApiData>),
      fetch("http://localhost:5001/api/data?file=2").then((r) => r.json() as Promise<ApiData>),
    ])
      .then(([d1, d2]) => {
        setP1(d1.points ?? []);
        setP2(d2.points ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error:", err);
        setIsLoading(false);
      });
  }, []);

  // Animate
  useEffect(() => {
    if (!playing) return;

    const id = setInterval(() => {
      if (mode === "flip") {
        setFrame((f) => (f === 1 ? 2 : 1));
      } else {
        setT((prev) => {
          const next = prev + 0.03; // speed
          return next >= 1 ? 0 : next;
        });
      }
    }, 50);

    return () => clearInterval(id);
  }, [playing, mode]);

  if (isLoading) return <p>Loading...</p>;
  if (p1.length === 0 && p2.length === 0) return <p>No data found</p>;

  const displayPoints: Point[] = (() => {
    if (mode === "flip") return frame === 1 ? p1 : p2;

    // smooth interpolate between p1 and p2 (pair by index)
    const n = Math.min(p1.length, p2.length);
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        x: p1[i].x + (p2[i].x - p1[i].x) * t,
        y: p1[i].y + (p2[i].y - p1[i].y) * t,
      });
    }
    return out;
  })();

  const first = displayPoints?.[0];

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Left large card */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>

          <CardContent>
            {/* Controls */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className="px-3 py-1 rounded border border-zinc-300 dark:border-zinc-700"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause" : "Play"}
              </button>

              <button
                className={`px-3 py-1 rounded border ${
                  mode === "flip"
                    ? "border-zinc-900 dark:border-zinc-200"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
                onClick={() => setMode("flip")}
              >
                Flip
              </button>

              <button
                className={`px-3 py-1 rounded border ${
                  mode === "smooth"
                    ? "border-zinc-900 dark:border-zinc-200"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
                onClick={() => setMode("smooth")}
              >
                Smooth
              </button>

              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                Mode: {mode}
                {mode === "flip" ? ` (showing file ${frame})` : ` (t=${t.toFixed(2)})`}
              </div>
            </div>

            {/* Info */}
            <div className="mb-3 text-sm text-zinc-600 dark:text-zinc-300 space-y-1">
              <div>
                <span className="font-semibold">Points shown:</span> {displayPoints.length}
              </div>
              <div>
                <span className="font-semibold">First point:</span>{" "}
                {first ? `(${first.x.toFixed(3)}, ${first.y.toFixed(3)})` : "none"}
              </div>
            </div>

            {/* Styled radar panel */}
            <div className="h-[60vh] w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name="X (m)" />
                  <YAxis type="number" dataKey="y" name="Y (m)" />
                  <Tooltip />
                  <Scatter data={displayPoints} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Right column with 2 stacked cards */}
        <div className="flex flex-col w-1/3 h-full gap-4">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Point Cloud 3D View</CardTitle>
            </CardHeader>
            <CardContent>{/* 3D visualization goes here */}</CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Detected Objects</CardTitle>
            </CardHeader>
            <CardContent>{/* Detected objects info goes here */}</CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
