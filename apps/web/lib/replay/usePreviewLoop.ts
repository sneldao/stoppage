/**
 * usePreviewLoop — the non-contingent baseline.
 *
 * When nothing is flowing (no live fixture, no active replay, not
 * launching one), this drives the home hero's snapshot + signal state
 * from a library of canned match scripts (the "anthology") so the
 * scoreboard ticks and goal drama fires with zero external input.
 * Badged honestly as PREVIEW by the caller (LiveInstrument's `preview`
 * prop) — it shows what the product looks like when the real feed is
 * down, it does not fake reality:
 *
 * - Scenarios differ in teams, competition, shape, and pacing; the
 *   play order is shuffled per session and beat timing is jittered so
 *   the loop never reads as a metronome.
 * - Stats reset per scenario (the old single-tape loop let corners
 *   keep climbing after the score wrapped — internally inconsistent).
 * - Every scenario ends on a full-time beat before the next match
 *   kicks off, like a channel between matches.
 *
 * Respects prefers-reduced-motion (holds the opening scenario at 0-0).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Fixture } from "@stoppage/txline";
import { usePageVisible } from "@/lib/dom/usePageVisible";

interface PreviewSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

type BeatKind = "kickoff" | "goal" | "corner" | "card" | "fulltime";

interface Beat {
  kind: BeatKind;
  /** Index into the scenario's teams for goals/cards; null for match-level beats. */
  side: 0 | 1 | null;
  /** Beat pacing, in ms. Jittered ±40% at runtime. */
  afterMs: number;
}

interface Scenario {
  home: string;
  away: string;
  competition: string;
  beats: Beat[];
}

const kick: (afterMs: number) => Beat = (afterMs) => ({ kind: "kickoff", side: null, afterMs });
const goal: (side: 0 | 1, afterMs: number) => Beat = (side, afterMs) => ({ kind: "goal", side, afterMs });
const corner: (afterMs: number) => Beat = (afterMs) => ({ kind: "corner", side: null, afterMs });
const card: (side: 0 | 1, afterMs: number) => Beat = (side, afterMs) => ({ kind: "card", side, afterMs });
const fulltime: (afterMs: number) => Beat = (afterMs) => ({ kind: "fulltime", side: null, afterMs });

const SCENARIOS: Scenario[] = [
  {
    home: "France", away: "Spain", competition: "World Cup",
    beats: [
      kick(0), corner(9_000), goal(0, 11_000), corner(13_000), goal(1, 12_000),
      card(0, 14_000), goal(0, 11_000), goal(1, 13_000), corner(10_000),
      goal(0, 12_000), corner(9_000), fulltime(11_000),
    ],
  },
  {
    home: "Arsenal", away: "Chelsea", competition: "Premier League",
    beats: [
      kick(0), card(1, 10_000), corner(9_000), card(0, 12_000), corner(11_000),
      goal(0, 13_000), card(1, 10_000), corner(9_000), goal(0, 12_000),
      corner(8_000), fulltime(10_000),
    ],
  },
  {
    home: "Brazil", away: "Argentina", competition: "Copa América",
    beats: [
      kick(0), goal(1, 9_000), goal(1, 11_000), corner(10_000), goal(0, 12_000),
      card(1, 11_000), corner(9_000), goal(1, 12_000), corner(10_000), fulltime(11_000),
    ],
  },
  {
    home: "Barcelona", away: "Real Madrid", competition: "La Liga",
    beats: [
      kick(0), corner(8_000), goal(0, 10_000), corner(9_000), goal(1, 11_000),
      card(0, 10_000), corner(9_000), goal(1, 12_000), corner(8_000), fulltime(10_000),
    ],
  },
  {
    home: "Japan", away: "Germany", competition: "World Cup",
    beats: [
      kick(0), corner(10_000), goal(1, 10_000), card(0, 12_000), goal(0, 11_000),
      corner(9_000), goal(0, 12_000), corner(10_000), fulltime(10_000),
    ],
  },
  {
    home: "Liverpool", away: "Man City", competition: "Premier League",
    beats: [
      kick(0), corner(9_000), goal(0, 10_000), goal(1, 11_000), corner(9_000),
      card(1, 12_000), goal(0, 11_000), corner(10_000), fulltime(10_000),
    ],
  },
];

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function jitter(ms: number): number {
  return Math.round(ms * (0.6 + Math.random() * 0.8));
}

/** A synthetic fixture so LiveInstrument's match face has team names. */
function previewFixture(scenario: Scenario): Fixture {
  return {
    FixtureId: 0,
    Participant1: scenario.home,
    Participant2: scenario.away,
    Country: scenario.competition,
    GameState: 2, // live-ish — the preview flag drives showLive, not GameState
    StartTime: new Date().toISOString(),
    matchId: "PREVIEW",
  } as unknown as Fixture;
}

interface UsePreviewLoopOptions {
  active: boolean;
  setSnapshot: (s: PreviewSnapshot | null) => void;
  setLastSignalType: (t: "goal" | "card" | "corner" | null) => void;
  setSignalVersion: (fn: (v: number) => number) => void;
  setScoringTeam: (t: string | null) => void;
  /** Fires on every goal/corner/card beat — feeds the demo event ticker. */
  onBeat?: (kind: "goal" | "corner" | "card", team: string | null) => void;
}

export function usePreviewLoop(opts: UsePreviewLoopOptions) {
  const { active, setSnapshot, setLastSignalType, setSignalVersion, setScoringTeam, onBeat } = opts;
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;
  const pageVisible = usePageVisible();
  const [fixture, setFixture] = useState<Fixture>(() => previewFixture(SCENARIOS[0]));
  const scenarioRef = useRef(SCENARIOS[0]);

  useEffect(() => {
    if (!active || !pageVisible) return;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    const order = shuffle(SCENARIOS);
    let scenarioIdx = 0;
    let beatIdx = 0;
    let score = { home: 0, away: 0 };
    let stats = { corners: 0, cards: 0 };
    let timeoutId: number | undefined;

    const applyScenario = (scenario: Scenario) => {
      scenarioRef.current = scenario;
      setFixture(previewFixture(scenario));
      score = { home: 0, away: 0 };
      stats = { corners: 0, cards: 0 };
    };

    const pushSnapshot = () =>
      setSnapshot({ updatedAt: Date.now(), score: { ...score }, stats: { ...stats } });

    const applyBeat = (beat: Beat) => {
      const teams = [scenarioRef.current.home, scenarioRef.current.away];
      switch (beat.kind) {
        case "kickoff":
          break;
        case "goal":
          if (beat.side === 0) score.home += 1;
          else score.away += 1;
          setScoringTeam(teams[beat.side ?? 0]);
          setLastSignalType("goal");
          setSignalVersion((v) => v + 1);
          onBeatRef.current?.("goal", teams[beat.side ?? 0]);
          break;
        case "corner":
          stats.corners += 1;
          setLastSignalType("corner");
          setSignalVersion((v) => v + 1);
          onBeatRef.current?.("corner", null);
          break;
        case "card":
          stats.cards += 1;
          setLastSignalType("card");
          setSignalVersion((v) => v + 1);
          onBeatRef.current?.("card", teams[beat.side ?? 0]);
          break;
      }
      pushSnapshot();
    };

    const scheduleNext = () => {
      const scenario = order[scenarioIdx % order.length];
      const isFulltime = beatIdx >= scenario.beats.length;
      // Full-time beat's afterMs = dwell on the final score before the
      // next match kicks off.
      const delay = isFulltime
        ? jitter(scenario.beats[scenario.beats.length - 1].afterMs)
        : jitter(scenario.beats[beatIdx].afterMs);

      timeoutId = window.setTimeout(() => {
        if (isFulltime) {
          scenarioIdx += 1;
          applyScenario(order[scenarioIdx % order.length]);
          beatIdx = 1; // applyScenario played the kickoff beat (0-0 board)
          pushSnapshot();
        } else {
          applyBeat(scenario.beats[beatIdx]);
          beatIdx += 1;
        }
        scheduleNext();
      }, delay);
    };

    if (reduceMotion) {
      // No canned motion — hold the first scenario at 0-0.
      applyScenario(order[0]);
      pushSnapshot();
      return;
    }

    applyScenario(order[0]);
    beatIdx = 1; // applyScenario played the kickoff beat (0-0 board)
    pushSnapshot();
    scheduleNext();
    return () => window.clearTimeout(timeoutId);
  }, [active, pageVisible, setSnapshot, setLastSignalType, setSignalVersion, setScoringTeam]);

  return useMemo(() => ({ previewFixture: fixture }), [fixture]);
}
