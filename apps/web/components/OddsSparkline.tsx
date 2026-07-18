"use client";

import { useEffect, useMemo, useState } from "react";

interface OddsPoint {
  ts: number;
  yes: number;
}

interface OddsSparklineProps {
  marketId: string;
  /** Current YES probability so the line always ends at the live value. */
  currentYes: number;
  width?: number;
  height?: number;
}

/**
 * Odds movement sparkline — renders the agent's recorded implied-YES
 * history for a market as a minimal SVG path. Falls back to the on-chain
 * current value when the agent has no history yet.
 */
export function OddsSparkline({ marketId, currentYes, width = 120, height = 32 }: OddsSparklineProps) {
  const [points, setPoints] = useState<OddsPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/odds/history?marketId=${encodeURIComponent(marketId)}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setPoints(data.points ?? []);
        }
      } catch { /* agent offline — sparkline is optional */ }
    };
    load();
    const id = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [marketId]);

  const { path, trend, delta } = useMemo(() => {
    const series = points.length >= 2 ? points.map((p) => p.yes) : null;
    if (!series) {
      return { path: "", trend: 0, delta: 0 };
    }
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = Math.max(max - min, 0.02);
    const pad = 2;
    const stepX = (width - pad * 2) / (series.length - 1);
    const yFor = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);
    const d = series
      .map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`)
      .join(" ");
    const first = series[0];
    const last = series[series.length - 1];
    const change = last - first;
    return { path: d, trend: Math.sign(change), delta: change };
  }, [points, width, height]);

  const color = trend > 0 ? "#00ff88" : trend < 0 ? "#ff958c" : "#8899b8";

  if (!path) {
    return (
      <div className="odds-sparkline odds-sparkline-empty" style={{ width, height }} title="Odds history building">
        <span style={{ color: "#8899b8", fontSize: 9, fontFamily: '"DM Mono", monospace' }}>
          {Math.round(currentYes * 100)}%
        </span>
      </div>
    );
  }

  return (
    <div className="odds-sparkline" style={{ width, height, position: "relative" }} title={`Odds moved ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        style={{
          position: "absolute",
          right: 0,
          bottom: -2,
          color,
          fontSize: 9,
          fontFamily: '"DM Mono", monospace',
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)}%
      </span>
    </div>
  );
}
