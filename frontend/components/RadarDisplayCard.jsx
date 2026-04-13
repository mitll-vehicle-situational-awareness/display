"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";

function computeCenter(points) {
  if (!points.length) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;

  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }

  return [sx / points.length, sy / points.length, sz / points.length];
}

function computeRadius(points, center) {
  let r2 = 0;
  for (const p of points) {
    const dx = p.x - center[0];
    const dy = p.y - center[1];
    const dz = p.z - center[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(r2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolatePoints(a, b, t) {
  const n = Math.max(a.length, b.length);
  const aFallback = a.length ? a[a.length - 1] : { x: 0, y: 0, z: 0 };
  const bFallback = b.length ? b[b.length - 1] : { x: 0, y: 0, z: 0 };

  const out = new Array(n);
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

function PointCloud({ points }) {
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

export default function RadarDisplayCard() {
  const [p1, setP1] = useState([]);
  const [p2, setP2] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);

  const dirRef = useRef(1);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);

  const [fixedCenter, setFixedCenter] = useState([0, 0, 0]);
  const [camPos, setCamPos] = useState([0, 0, 10]);

  useEffect(() => {
    Promise.all([
      fetch("http://127.0.0.1:5001/api/data?file=1").then((r) => r.json()),
      fetch("http://127.0.0.1:5001/api/data?file=2").then((r) => r.json()),
    ])
      .then(([d1, d2]) => {
        const pts1 = d1.points ?? [];
        const pts2 = d2.points ?? [];

        setP1(pts1);
        setP2(pts2);

        const all = [...pts1, ...pts2];
        const c = computeCenter(all);
        const radius = computeRadius(all, c);

        setFixedCenter(c);

        const dist = Math.max(10, radius * 2.5);
        setCamPos([c[0], c[1] + dist * 0.2, c[2] + dist]);

        setIsLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }

    const DURATION_MS = 700;

    const step = (ts) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      setT((prev) => {
        let next = prev + (dt / DURATION_MS) * dirRef.current;

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
    const tt = t * t * (3 - 2 * t);
    return interpolatePoints(p1, p2, tt);
  }, [p1, p2, t]);

  const labelFrame = t < 0.5 ? 1 : 2;

  if (isLoading) {
    return (
      <Card className="rounded-2xl border border-white/10 bg-[#0B1221] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
        <CardContent className="py-10 text-center text-white/70">
          Loading radar...
        </CardContent>
      </Card>
    );
  }

  return (
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
          <Canvas camera={{ position: camPos, fov: 50 }}>
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
            <PointCloud points={displayPoints} />

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
  );
}

