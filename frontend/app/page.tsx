"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { DetectedObjectNotification } from "@/components/ui/DetectedObjectNotification";


type Point = { x: number; y: number; z: number };
interface ApiData {
  points: Point[];
}

interface Detection {
  label: string;
  confidence: number;
}

function computeCenter(points: Point[]): [number, number, number] {
  if (!points.length) return [0, 0, 0];
  let sx = 0,
    sy = 0,
    sz = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  return [sx / points.length, sy / points.length, sz / points.length];
}

function computeRadius(points: Point[], center: [number, number, number]) {
  let r2 = 0;
  for (const p of points) {
    const dx = p.x - center[0];
    const dy = p.y - center[1];
    const dz = p.z - center[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(r2);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Interpolates points by index between A and B.
 * If lengths differ, we "pad" using the last available point in that set (or origin).
 */
function interpolatePoints(a: Point[], b: Point[], t: number): Point[] {
  const n = Math.max(a.length, b.length);
  const aFallback = a.length ? a[a.length - 1] : { x: 0, y: 0, z: 0 };
  const bFallback = b.length ? b[b.length - 1] : { x: 0, y: 0, z: 0 };

  const out = new Array<Point>(n);
  for (let i = 0; i < n; i++) {
    const pa = a[i] ?? aFallback;
    const pb = b[i] ?? bFallback;
    out[i] = {
      x: lerp(pa.x, pb.x, t),
      y: lerp(pa.y, pb.y, t),
      z: lerp(pa.z, pb.z, t),
    };
  }
  return out;
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
      <pointsMaterial color="#7CFFB2" size={0.12} sizeAttenuation />
    </points>
  );
}

export default function Home() {
  const [p1, setP1] = useState<Point[]>([]);
  const [p2, setP2] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [detections, setDetections] = useState<Detection[]>([]);

  const [playing, setPlaying] = useState(true);

  // Ping-pong tween progress 0..1, and direction (+1 forward, -1 backward)
  const [t, setT] = useState(0);
  const dirRef = useRef<1 | -1>(1);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Fixed radar view (prevents snapping/jumping)
  const [fixedCenter, setFixedCenter] = useState<[number, number, number]>([
    0, 0, 0,
  ]);
  const [camPos, setCamPos] = useState<[number, number, number]>([0, 0, 10]);

  // Load both CSV snapshots (each returns x,y,z)
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
        const pts1 = d1.points ?? [];
        const pts2 = d2.points ?? [];

        setP1(pts1);
        setP2(pts2);

        // Compute a stable target + camera based on all points from both snapshots
        const all = [...pts1, ...pts2];
        const c = computeCenter(all);
        const radius = computeRadius(all, c);

        setFixedCenter(c);

        // Stable camera distance that fits the data (tweak multiplier if needed)
        const dist = Math.max(10, radius * 2.5);
        setCamPos([c[0], c[1] + dist * 0.2, c[2] + dist]);

        setIsLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setIsLoading(false);
      });
  }, []);

  // Fetch detected objects periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("http://127.0.0.1:5001/api/detections")
        .then((r) => r.json())
        .then((data: { detections: Detection[] }) => {
          setDetections(data.detections);
        })
        .catch((e) => console.error("Failed to fetch detections:", e));
    }, 1000); // Poll every 1000ms

    return () => clearInterval(interval);
  }, []);

  // Animate t continuously back-and-forth (ping-pong)
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }

    const DURATION_MS = 700; // one-way duration (0->1 or 1->0)

    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      setT((prev) => {
        let next = prev + (dt / DURATION_MS) * dirRef.current;

        // Bounce at ends without resetting
        if (next >= 1) {
          next = 1;
          dirRef.current = -1;
        } else if (next <= 0) {
          next = 0;
          dirRef.current = 1;
        }

        return next;
      });

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [playing]);

  const displayPoints = useMemo(() => {
    // Smoothstep easing (nice feel)
    const tt = t * t * (3 - 2 * t);
    return interpolatePoints(p1, p2, tt);
  }, [p1, p2, t]);

  // Label only
  const labelFrame: 1 | 2 = t < 0.5 ? 1 : 2;

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
                    detected_positions{labelFrame === 1 ? "" : "2"}.csv • points:{" "}
                    {displayPoints.length}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? "Pause" : "Play"}
                  </Button>
                </div>

                <div className="h-[32vh] rounded-xl border border-white/10 bg-[#060B15] overflow-hidden">
                  {/* Camera + target are FIXED so the view doesn't snap */}
                  <Canvas camera={{ position: camPos, fov: 50 }}>
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

                    {/* Controls (fixed target prevents jumping) */}
                    <OrbitControls
                      target={fixedCenter}
                      enablePan
                      enableRotate
                      enableZoom
                    />
                  </Canvas>
                </div>

                <div className="mt-2 text-[11px] text-white/50">
                  Drag to rotate • Scroll to zoom
                </div>
              </CardContent>
            </Card>

            {/* ✅ Detected Objects card with live data from webcam */}
            <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-wide text-white/90">
                  Detected Objects ({detections.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {detections.length === 0 ? (
                  <div className="text-xs text-white/50">No objects detected</div>
                ) : (
                  detections.map((det, idx) => (
                    <DetectedObjectNotification
                      key={idx}
                      icon={
                        det.label.toLowerCase().includes("person")
                          ? "🚶"
                          : det.label.toLowerCase().includes("car") ||
                            det.label.toLowerCase().includes("vehicle") ||
                            det.label.toLowerCase().includes("truck")
                          ? "🚗"
                          : det.label.toLowerCase().includes("bike") ||
                            det.label.toLowerCase().includes("bicycle")
                          ? "🚴"
                          : "📦"
                      }
                      object={det.label}
                      distance="–"
                      speed="–"
                      angle="–"
                      riskLevel={
                        det.confidence > 0.8
                          ? "High"
                          : det.confidence > 0.6
                          ? "Medium"
                          : "Low"
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
