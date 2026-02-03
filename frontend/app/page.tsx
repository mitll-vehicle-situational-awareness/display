"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";

type Point = { x: number; y: number; z: number };
interface ApiData {
  points: Point[];
}

function PointCloud({ points }: { points: Point[] }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      arr[i * 3 + 0] = points[i].x;
      arr[i * 3 + 1] = points[i].y;
      arr[i * 3 + 2] = points[i].z;
    }
    return arr;
  }, [points]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
  }, [positions]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color="#7CFFB2"
        size={0.12}
        sizeAttenuation
      />
    </points>
  );
}

export default function Home() {
  const [p1, setP1] = useState<Point[]>([]);
  const [p2, setP2] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState<1 | 2>(1);

  // Load both CSV snapshots (each returns x,y,z)
  useEffect(() => {
    Promise.all([
      fetch("http://127.0.0.1:5001/api/data?file=1").then((r) => r.json() as Promise<ApiData>),
      fetch("http://127.0.0.1:5001/api/data?file=2").then((r) => r.json() as Promise<ApiData>),
    ])
      .then(([d1, d2]) => {
        setP1(d1.points ?? []);
        setP2(d2.points ?? []);
        setIsLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setIsLoading(false);
      });
  }, []);

  // Flip between the two snapshots
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setFrame((f) => (f === 1 ? 2 : 1)), 700);
    return () => clearInterval(id);
  }, [playing]);

  const displayPoints = frame === 1 ? p1 : p2;

  // Center camera roughly around points (simple heuristic)
  const center = useMemo(() => {
    if (displayPoints.length === 0) return [0, 0, 0] as [number, number, number];
    let sx = 0, sy = 0, sz = 0;
    for (const p of displayPoints) { sx += p.x; sy += p.y; sz += p.z; }
    return [sx / displayPoints.length, sy / displayPoints.length, sz / displayPoints.length] as [number, number, number];
  }, [displayPoints]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070B14] text-white">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070B14] text-white">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="flex gap-6">
          {/* LEFT: Live Camera */}
          <div className="w-2/3">
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
                  src="http://127.0.0.1:5001/api/webcam"
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
          </div>

          {/* RIGHT: 3D Radar */}
          <div className="w-1/3 flex flex-col gap-6">
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                  Radar Data (3D)
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs text-white/60">
                    detected_positions{frame === 1 ? "" : "2"}.csv • points: {displayPoints.length}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)}>
                    {playing ? "Pause" : "Play"}
                  </Button>
                </div>

                <div className="h-[32vh] rounded-xl border border-white/10 bg-[#060B15] overflow-hidden">
                  <Canvas camera={{ position: [center[0], center[1], center[2] + 10], fov: 50 }}>
                    <ambientLight intensity={0.7} />
                    <pointLight position={[10, 10, 10]} intensity={0.8} />

                    {/* Grid “floor” */}
                    <Grid
                      args={[20, 20]}
                      cellSize={1}
                      cellThickness={0.5}
                      sectionSize={5}
                      sectionThickness={1}
                      fadeDistance={25}
                      fadeStrength={1}
                      infiniteGrid={false}
                    />

                    {/* Axes */}
                    <axesHelper args={[5]} />

                    {/* Point cloud */}
                    <PointCloud points={displayPoints} />

                    {/* Controls */}
                    <OrbitControls target={center} enablePan enableRotate enableZoom />
                  </Canvas>
                </div>

                <div className="mt-2 text-[11px] text-white/50">
                  Drag to rotate • Scroll to zoom
                </div>
              </CardContent>
            </Card>

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
