"use client";

import { useEffect, useRef, useState } from "react";
import type { JevMindResponse } from "@/app/api/jev-mind/route";

export interface JevMindInput {
  matchId: string | null;
  home: string | null;
  away: string | null;
  scoreHome: number;
  scoreAway: number;
  corners: number;
  cards: number;
  openMarkets: number;
  yesShare: number | null;
}

/**
 * useJevMind — polls the advisory /api/jev-mind route when the match
 * snapshot changes (debounced). Display only; never gates betting,
 * market creation, or settlement.
 */
export function useJevMind(input: JevMindInput | null, signalVersion: number) {
  const [data, setData] = useState<JevMindResponse | null>(null);
  const [pending, setPending] = useState(false);
  const keyRef = useRef<string>("");

  useEffect(() => {
    if (!input || !input.matchId) return;
    const key = JSON.stringify([input.matchId, input.scoreHome, input.scoreAway, input.corners, input.cards, input.openMarkets, input.yesShare, signalVersion]);
    if (key === keyRef.current) return;
    keyRef.current = key;
    let cancelled = false;
    setPending(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/jev-mind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(`jev-mind ${res.status}`);
        const json = (await res.json()) as JevMindResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input?.matchId, input?.scoreHome, input?.scoreAway, input?.corners, input?.cards, input?.openMarkets, input?.yesShare, signalVersion]);

  return { data, pending };
}
