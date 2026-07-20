"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SignalType = "goal" | "corner" | "card";

/** Minimal match state the signal detector needs (score + running stats). */
export interface SignalSnapshot {
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

/** Shape of SSE match events (LiveInstrument / LiveMatchBar onNewEvent). */
export interface MatchEventLike {
  type: string;
  team?: unknown;
}

const EVENT_SIGNAL: Record<string, SignalType> = {
  goal_scored: "goal",
  own_goal: "goal",
  card_shown: "card",
  corner_awarded: "corner",
};

/**
 * Shared live-signal state for the match drama layer (MatchPulse ripples,
 * MomentAlert overlays). Detects goal/card/corner moments two ways:
 *
 * - Snapshot diffs: when `detect` is true, score/stat changes between
 *   consecutive snapshots fire the matching signal (polled live feeds).
 * - SSE events: `handleMatchEvent` maps streamed match events directly
 *   (replays and previews, where the caller sets `detect` to false).
 *
 * One implementation — home, the match room, and market detail all consume
 * this hook rather than carrying their own copies.
 */
export function useMatchSignals({ snapshot, detect }: { snapshot: SignalSnapshot | null; detect: boolean }) {
  const [signalVersion, setSignalVersion] = useState(0);
  const [lastSignalType, setLastSignalType] = useState<SignalType | null>(null);
  const [scoringTeam, setScoringTeam] = useState<string | null>(null);
  const previousSignal = useRef<string | null>(null);

  // Detect score/stat changes → fire signal animations.
  useEffect(() => {
    if (!detect) { previousSignal.current = null; return; }
    if (!snapshot) return;
    const next = `${snapshot.score.home}:${snapshot.score.away}:${snapshot.stats.corners}:${snapshot.stats.cards}`;
    if (previousSignal.current && previousSignal.current !== next) {
      const [ph, pa, pc, pk] = previousSignal.current.split(":").map(Number);
      if (snapshot.score.home !== ph || snapshot.score.away !== pa) setLastSignalType("goal");
      else if (snapshot.stats.cards !== pk) setLastSignalType("card");
      else if (snapshot.stats.corners !== pc) setLastSignalType("corner");
      setSignalVersion((v) => v + 1);
    }
    previousSignal.current = next;
  }, [snapshot, detect]);

  // Auto-clear alert badge
  useEffect(() => {
    if (!lastSignalType) return;
    const t = setTimeout(() => setLastSignalType(null), 5_000);
    return () => clearTimeout(t);
  }, [lastSignalType]);

  const handleMatchEvent = useCallback((evt: MatchEventLike) => {
    const type = EVENT_SIGNAL[evt.type];
    if (type) { setLastSignalType(type); setSignalVersion((v) => v + 1); }
    if (evt.team) setScoringTeam(String(evt.team));
  }, []);

  return {
    signalVersion,
    lastSignalType,
    scoringTeam,
    setSignalVersion,
    setLastSignalType,
    setScoringTeam,
    handleMatchEvent,
  };
}
