"use client";

import { useEffect, useRef, useState } from "react";
import { impliedProbability, type Market } from "@stoppage/sdk";

/**
 * OddsSurgeCallout — loud odds-drama, inline on the market detail.
 *
 * Samples the market's implied YES probability on every store update and
 * keeps a rolling 60s window. When the window's max-min swing crosses
 * 10 percentage points, surfaces a "🔥 Odds moving" callout showing the
 * range. Reactive to Helius pool updates — no extra endpoint, no
 * duplication of /api/odds/shifts (which SharpMoves already polls).
 */
const WINDOW_MS = 60_000;
const THRESHOLD = 0.10; // 10 percentage points

export function OddsSurgeCallout({ market }: { market: Market }) {
  const [surge, setSurge] = useState<null | { min: number; max: number }>(null);
  const samplesRef = useRef<{ yes: number; ts: number }[]>([]);

  useEffect(() => {
    if (market.status !== "open") { setSurge(null); samplesRef.current = []; return; }
    const yes = impliedProbability(market).yes;
    const now = Date.now();
    const samples = samplesRef.current;
    samples.push({ yes, ts: now });
    while (samples.length && now - samples[0].ts > WINDOW_MS) samples.shift();
    if (samples.length >= 2) {
      let min = samples[0].yes;
      let max = samples[0].yes;
      for (const s of samples) {
        if (s.yes < min) min = s.yes;
        if (s.yes > max) max = s.yes;
      }
      setSurge(Math.abs(max - min) >= THRESHOLD ? { min, max } : null);
    }
  }, [market]);

  if (!surge) return null;
  return (
    <div className="odds-surge-callout" role="status">
      <span className="odds-surge-flame">🔥</span>
      <span className="odds-surge-text">
        Odds moving — YES {Math.round(surge.min * 100)}% → {Math.round(surge.max * 100)}% in the last 60s
      </span>
    </div>
  );
}
