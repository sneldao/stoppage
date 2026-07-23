"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "@/lib/dom/usePageVisible";
import type { CalibrationPayload } from "@/lib/calibration/types";

const REFRESH_MS = 60_000;

export function useCalibration() {
  const [data, setData] = useState<CalibrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageVisible = usePageVisible();
  // Keep the latest refresh fn in a ref so the visibility effect can call it
  // without re-subscribing the interval on every visibility change.
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/calibration");
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Calibration feed unavailable");
      }
      setData(json as CalibrationPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calibration unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  refreshRef.current = refresh;

  // Initial load + 60s polling interval.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // When the tab becomes visible again, refresh immediately so the board
  // doesn't show stale data from when the tab was hidden. Also re-fetch
  // on visibility regain — matches the useMarketQuote pattern.
  useEffect(() => {
    if (!pageVisible) return;
    void refreshRef.current();
  }, [pageVisible]);

  return { data, loading, error, refresh };
}
