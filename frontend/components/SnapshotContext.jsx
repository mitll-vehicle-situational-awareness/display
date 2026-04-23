"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * One client-side poll of /api/snapshot that all dashboard cards read from.
 * Because every field comes from the same sensor_callback invocation on the
 * backend, the webcam image, the RD heatmap, and the detections list are
 * always in sync — no more drift between "what you see" and "what's listed".
 *
 * Usage (at the page root):
 *   <SnapshotProvider intervalMs={250}>
 *     <WebcamCard />
 *     <RangeDopplerCard />
 *     <DetectedObjectsCard />
 *   </SnapshotProvider>
 *
 * Inside any card:
 *   const { snapshot, isLive, lastUpdate } = useSnapshot();
 */

const SnapshotContext = createContext({
  snapshot: null,
  isLive: false,
  lastUpdate: null,
});

export function SnapshotProvider({ children, intervalMs = 250 }) {
  const [snapshot, setSnapshot] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      // Skip if a previous request is still in flight — prevents pileups if
      // the backend is momentarily slow.
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        const res = await fetch(
          `http://${window.location.hostname}:5001/api/snapshot`
        );
        // 204 = sensors not ready yet; keep the last good snapshot visible.
        if (res.status === 204) return;
        if (!res.ok) return;

        const data = await res.json();
        if (cancelled) return;

        setSnapshot(data);
        setLastUpdate(new Date());
      } catch (e) {
        console.error("snapshot fetch failed:", e);
      } finally {
        inFlight.current = false;
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  // Consider the feed "live" if we've had an update in the last ~1.5s.
  const isLive =
    lastUpdate !== null && Date.now() - lastUpdate.getTime() < 1500;

  return (
    <SnapshotContext.Provider value={{ snapshot, isLive, lastUpdate }}>
      {children}
    </SnapshotContext.Provider>
  );
}

export function useSnapshot() {
  return useContext(SnapshotContext);
}

/**
 * Convenience: turn the base64 image fields from the snapshot into
 * ready-to-use data URLs for <img src=...>. Returns {cameraSrc, rdSrc}.
 */
export function useSnapshotImages() {
  const { snapshot } = useSnapshot();
  const cameraSrc =
    snapshot?.camera_image
      ? `data:image/${snapshot.camera_format};base64,${snapshot.camera_image}`
      : null;
  const rdSrc =
    snapshot?.range_doppler_image
      ? `data:image/${snapshot.range_doppler_format};base64,${snapshot.range_doppler_image}`
      : null;
  return { cameraSrc, rdSrc };
}