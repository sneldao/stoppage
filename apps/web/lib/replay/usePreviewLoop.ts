/**
 * usePreviewLoop — the non-contingent baseline.
 *
 * When nothing is flowing (no live fixture, no active replay, not
 * launching one), this drives the home hero's snapshot + signal state
 * from a canned, looping script so the scoreboard ticks and goal drama
 * fires with zero external input. Badged honestly as PREVIEW by the
 * caller (LiveInstrument's `preview` prop) — it shows what the product
 * looks like when the real feed is down, it does not fake reality.
 *
 * Respects prefers-reduced-motion (no canned goals, just a static 0-0).
 */

import { useEffect, useMemo } from "react";
import type { Fixture } from "@stoppage/txline";
import { usePageVisible } from "@/lib/dom/usePageVisible";

interface PreviewSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

interface ScriptStep {
  home: number;
  away: number;
  team: string | null;
  kind: "kickoff" | "goal";
}

const SCRIPT: ScriptStep[] = [
  { home: 0, away: 0, team: null, kind: "kickoff" },
  { home: 1, away: 0, team: "France", kind: "goal" },
  { home: 1, away: 1, team: "Spain", kind: "goal" },
  { home: 2, away: 1, team: "France", kind: "goal" },
  { home: 2, away: 2, team: "Spain", kind: "goal" },
  { home: 3, away: 2, team: "France", kind: "goal" },
];

/** A synthetic fixture so LiveInstrument's match face has team names. */
export const PREVIEW_FIXTURE = {
  FixtureId: 0,
  Participant1: "France",
  Participant2: "Spain",
  Country: "Preview",
  GameState: 2, // live-ish — the preview flag drives showLive, not GameState
  StartTime: new Date().toISOString(),
  matchId: "PREVIEW-FRA-ESP",
} as unknown as Fixture;

interface UsePreviewLoopOptions {
  active: boolean;
  setSnapshot: (s: PreviewSnapshot | null) => void;
  setLastSignalType: (t: "goal" | "card" | "corner" | null) => void;
  setSignalVersion: (fn: (v: number) => number) => void;
  setScoringTeam: (t: string | null) => void;
}

export function usePreviewLoop(opts: UsePreviewLoopOptions) {
  const { active, setSnapshot, setLastSignalType, setSignalVersion, setScoringTeam } = opts;
  const pageVisible = usePageVisible();

  useEffect(() => {
    if (!active) return;
    setSnapshot({ updatedAt: Date.now(), score: { home: 0, away: 0 }, stats: { corners: 0, cards: 0 } });
  }, [active, setSnapshot]);

  useEffect(() => {
    if (!active || !pageVisible) return;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    if (reduceMotion) return;

    let step = 1;
    const advance = () => {
      const s = SCRIPT[step % SCRIPT.length];
      const corners = step;
      const cards = Math.floor(step / 2);
      setSnapshot({ updatedAt: Date.now(), score: { home: s.home, away: s.away }, stats: { corners, cards } });
      if (s.kind === "goal" && s.team) {
        setScoringTeam(s.team);
        setLastSignalType("goal");
        setSignalVersion((v) => v + 1);
      }
      step++;
    };
    advance();
    const id = window.setInterval(advance, 13_000); // a goal every ~13s
    return () => window.clearInterval(id);
  }, [active, pageVisible, setSnapshot, setLastSignalType, setSignalVersion, setScoringTeam]);

  return useMemo(() => ({ previewFixture: PREVIEW_FIXTURE }), []);
}
