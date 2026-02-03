"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";

type Point = { x: number; y: number; z: number };
interface ApiData {
  points: Point[];
}

/**
 * Computes a bounding sphere (center + radius) for a set of points.
 */
function computeBoundingSphere(points: Point[]) {
  if (points.length === 0) {
    return { center: new THREE.Vector3(0, 0, 0), radius: 5 };
  }
  const box = new THREE.Box3();
  for (const p of points) box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  // radius ~ half diagonal
  const radius = Math.max(0.001, size.length() * 0.5);
  return { center, radius };
}

/**
 * Sets camera once to frame the bounding sphere.
 * Also sets near/far appropriately so points don’t clip.
 */
function FitCameraOnce({
  center,
  radius,
}: {
  center: [number, number, number];
  radius: number;
}) {
  const { camera } = useThree();
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const c = new THREE.Vector3(center[0], center[1], center[2]);

    // Distance that fits sphere in view (simple heuristic)
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const fovRad = (fov * Math.PI) / 180;
    const dist = radius / Math.tan(fovRad / 2);

    camera.position.set(c.x, c.y, c.z + dist * 1.2);
    camera.near = Math.max(0.01, dist / 100);
    camera.far = dist * 100;
    camera.lookAt(c);
    camera.updateProjectionMatrix();
  }, [camera, center, radius]);

  return null;
}

/**
 * Interpolates point cloud between two snapshots a -> b using t in [0,1].
 * Assumes points correspond by index (same ordering). Uses min length.
 */
function LerpPointCloud({
  a,
  b,
  t,
  pointSize = 0.12,
}: {
  a: Point[];
  b: Point[];
  t: number;
  pointSize?: number;
}) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);

  const attr = useMemo(() => {
    const n = Math.min(a.length, b.length);
    const arr = new Float32Array(n * 3);
    const attribute = new THREE.BufferAttribute(arr, 3);
    geom.setAttribute("position", attribute);
    geom.computeBoundingSphere();
    return attribute;
  }, [geom, a.length, b.length]);

  useFrame(() => {
    const n = Math.min(a.length, b.length);
    const arr = attr.array as Float32Array;

    for (let i = 0; i < n; i++) {
      const ax = a[i].x,
        ay = a[i].y,
        az = a[i].z;
      const bx = b[i].x,
        by = b[i].y,
        bz = b[i].z;

      arr[i * 3 + 0] = ax + (bx - ax) * t;
      arr[i * 3 + 1] = ay + (by - ay) * t;
      arr[i * 3 + 2] = az + (bz - az) * t;
    }

    attr.needsUpdate = true;
    geom.computeBoundingSphere();
  });

  return (
    <points geometry={geom}>
      <pointsMaterial color="#7CFFB2" size={pointSize} sizeAttenuation />
    </points>
  );
}

export default function Home() {
  const [p1, setP1] = useState<Point[]>([]);
  const [p2, setP2] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [playing, setPlaying] = useState(true);

  // Animation progress [0..1], ping-pongs between 0 and 1
  const [t, setT] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

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
      .catch((e) => {
        console.error(e);
        setIsLoading(false);
      });
  }, []);

  // Smooth ping-pong animation between the two snapshots
  useEffect(() => {
    if (!playing) return;

    let raf = 0;
    let last = performance.now();
    const secondsPerLeg = 0.7; // speed knob

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      setT((prev) => {
        let next = prev + dir * (dt / secondsPerLeg);
        if (next >= 1) {
          next = 1;
          setDir(-1);
        } else if (next <= 0) {
          next = 0;
          setDir(1);
        }
        return next;
      });

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, dir]);

  const pointCount = Math.min(p1.length, p2.length);

  // Use BOTH frames to compute a fixed bounding sphere
  const bounds = useMemo(() => {
    const all = [...p1, ...p2];
    const { center, radius } = computeBoundingSphere(all);
    return {
      center: [center.x, center.y, center.z] as [number, number, number],
      radius,
    };
  }, [p1, p2]);

  // Make point size scale a bit with data size (so it stays visible)
  const pointSize = useMemo(() => {
    // if radius is big, points should be slightly bigger; if tiny, keep a minimum
    return Math.max(0.03, Math.min(0.25, bounds.radius / 80));
  }, [bounds.radius]);

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
                    detected_positions.csv ↔ detected_positions2.csv • points:{" "}
                    {pointCount} • t: {t.toFixed(2)}
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
                  <Canvas camera={{ fov: 50 }}>
                    {/* Ensure camera frames data so you can always see it */}
                    <FitCameraOnce center={bounds.center} radius={bounds.radius} />

                    <ambientLight intensity={0.7} />
                    <pointLight position={[10, 10, 10]} intensity={0.8} />

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

                    <axesHelper args={[5]} />

                    <LerpPointCloud a={p1} b={p2} t={t} pointSize={pointSize} />

                    {/* Keep controls target fixed, so axes/grid don’t “follow” the motion */}
                    <OrbitControls
                      target={bounds.center}
                      enablePan
                      enableRotate
                      enableZoom
                    />
                  </Canvas>
                </div>

                <div className="mt-2 text-[11px] text-white/50">
                  Drag to rotate • Scroll to zoom
                </div>

                {p1.length !== p2.length && (
                  <div className="mt-2 text-[11px] text-amber-300/80">
                    Note: point counts differ (frame1={p1.length}, frame2={p2.length}). Interpolating first{" "}
                    {pointCount} points by index.
                  </div>
                )}
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
