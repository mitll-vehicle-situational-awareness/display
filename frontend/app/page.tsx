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
  const [mode, setMode] = useState<"flip" | "smooth">("smooth");
  const [frame, setFrame] = useState<1 | 2>(1);
  const [t, setT] = useState(0);

  // Load both CSV snapshots once
  useEffect(() => {
    Promise.all([
      fetch("http://127.0.0.1:5001/api/data?file=1").then(r => r.json() as Promise<ApiData>),
      fetch("http://127.0.0.1:5001/api/data?file=2").then(r => r.json() as Promise<ApiData>),
    ])
      .then(([d1, d2]) => {
        setP1(d1.points ?? []);
        setP2(d2.points ?? []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setIsLoading(false);
      });
  }, []);

  // Animation loop
  useEffect(() => {
    if (!playing) return;

    const id = setInterval(() => {
      if (mode === "flip") {
        setFrame(f => (f === 1 ? 2 : 1));
      } else {
        setT(prev => {
          const next = prev + 0.03;
          return next >= 1 ? 0 : next;
        });
      }
    }, 50);

    return () => clearInterval(id);
  }, [playing, mode]);

  // Points to display
  const displayPoints: Point[] = useMemo(() => {
    if (mode === "flip") return frame === 1 ? p1 : p2;

    const n = Math.min(p1.length, p2.length);
    return Array.from({ length: n }, (_, i) => ({
      x: p1[i].x + (p2[i].x - p1[i].x) * t,
      y: p1[i].y + (p2[i].y - p1[i].y) * t,
    }));
  }, [p1, p2, frame, mode, t]);

  // 🔒 FIXED AXIS DOMAINS (computed once from both datasets)
  const { xDomain, yDomain } = useMemo(() => {
    const all = [...p1, ...p2];
    if (all.length === 0) return { xDomain: [0, 1], yDomain: [0, 1] };

    const xs = all.map(p => p.x);
    const ys = all.map(p => p.y);
    const pad = 0.25;

    return {
      xDomain: [Math.min(...xs) - pad, Math.max(...xs) + pad] as [number, number],
      yDomain: [Math.min(...ys) - pad, Math.max(...ys) + pad] as [number, number],
    };
  }, [p1, p2]);

  if (isLoading) return <p>Loading...</p>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Left card */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>

          <CardContent>
            {/* Controls */}
            <div className="mb-3 flex items-center gap-2">
              <button
                className="px-3 py-1 rounded border"
                onClick={() => setPlaying(p => !p)}
              >
                {playing ? "Pause" : "Play"}
              </button>

              <button
                className={`px-3 py-1 rounded border ${mode === "flip" ? "font-semibold" : ""}`}
                onClick={() => setMode("flip")}
              >
                Flip
              </button>

              <button
                className={`px-3 py-1 rounded border ${mode === "smooth" ? "font-semibold" : ""}`}
                onClick={() => setMode("smooth")}
              >
                Smooth
              </button>
            </div>

            {/* Radar panel */}
            <div className="h-[65vh] w-full rounded-xl border bg-white dark:bg-zinc-950 p-3">
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" domain={xDomain} />
                  <YAxis type="number" dataKey="y" domain={yDomain} />
                  <Tooltip />
                  <Scatter data={displayPoints} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col w-1/3 h-full gap-4">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Point Cloud 3D View</CardTitle>
            </CardHeader>
            <CardContent />
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Detected Objects</CardTitle>
            </CardHeader>
            <CardContent />
          </Card>
        </div>
      </main>
    </div>
  );
}
