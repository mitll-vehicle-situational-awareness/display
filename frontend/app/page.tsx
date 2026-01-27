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

  // Load both CSV snapshots once
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

  if (isLoading) return <p>Loading...</p>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Main left card — camera placeholder */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>
          <CardContent className="flex h-full items-center justify-center text-zinc-500 dark:text-zinc-400">
            Camera feed will be displayed here
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col w-1/3 h-full gap-4">
          {/* Radar / Point Cloud */}
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Radar Point Cloud</CardTitle>
            </CardHeader>

            <CardContent>
              {/* Controls */}
              <div className="mb-2 flex items-center gap-3 text-sm">
                <button
                  className="px-3 py-1 rounded border"
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <div className="text-zinc-600 dark:text-zinc-300">
                  Showing: detected_positions{frame === 1 ? "" : "2"}.csv
                </div>
              </div>

              {/* Radar panel */}
              <div className="h-[32vh] w-full rounded-xl border bg-white dark:bg-zinc-950 p-2">
                <ResponsiveContainer>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={xDomain}
                      tickFormatter={(v) => Number(v).toFixed(2)}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={yDomain}
                      tickFormatter={(v) => Number(v).toFixed(2)}
                    />
                    <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                    <Scatter data={displayPoints} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Bottom right card */}
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Detected Objects</CardTitle>
            </CardHeader>
            <CardContent className="text-zinc-500 dark:text-zinc-400">
              Object metadata will appear here
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
