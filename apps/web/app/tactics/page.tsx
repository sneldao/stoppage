"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TacticAnswer, TacticBeat } from "@/app/api/jev-tactics/route";

/**
 * /tactics — "Jev manages the last 10 minutes." A retro manager-style
 * passage of play: scripted situations, but every action AND its
 * execution grade come from live Jev calls. Simulated match, real
 * decisions — labeled as such.
 */

interface ScriptBeat extends Omit<TacticBeat, "scoreHome" | "scoreAway"> {}

const SCRIPT: ScriptBeat[] = [
  {
    minute: 78, zone: "Right wing", player: { name: "B. Saka", pos: "RW", pace: 17, shooting: 12, passing: 14, dribbling: 16 },
    situation: "Winger isolated 1v1 against a tired left-back, box loaded with two runners.",
    options: [
      { id: "dribble", label: "Take him on", hint: "Dribbling 16 vs tired legs" },
      { id: "cross", label: "Early cross", hint: "Passing 14, two runners in the box" },
      { id: "shoot", label: "Cut inside, shoot", hint: "Shooting 12 from a tight angle" },
    ],
  },
  {
    minute: 81, zone: "Centre circle", player: { name: "M. Odegaard", pos: "CM", pace: 12, shooting: 13, passing: 17, dribbling: 14 },
    situation: "Counter on: striker bending a run behind a high line, two defenders scrambling.",
    options: [
      { id: "through_ball", label: "Slide it through", hint: "Passing 17, run is on" },
      { id: "dribble", label: "Carry it forward", hint: "Dribbling 14, space ahead" },
      { id: "hold", label: "Slow it down", hint: "Safe but kills the break" },
    ],
  },
  {
    minute: 84, zone: "Corner flag", player: { name: "B. Saka", pos: "RW", pace: 17, shooting: 12, passing: 14, dribbling: 16 },
    situation: "Corner won. Six-yard box crowded, keeper rooted.",
    options: [
      { id: "cross_near", label: "Near-post whip", hint: "Flick-on routines favor near post" },
      { id: "cross_far", label: "Far-post floater", hint: "Back-post runner unmarked" },
      { id: "cross_short", label: "Short corner", hint: "Keeps possession, low chaos" },
    ],
  },
  {
    minute: 87, zone: "Penalty spot", player: { name: "V. Gyokeres", pos: "ST", pace: 15, shooting: 16, passing: 11, dribbling: 13 },
    situation: "Clean through on goal, keeper rushing out, one covering defender.",
    options: [
      { id: "shoot", label: "Lash it", hint: "Shooting 16, keeper set" },
      { id: "chip", label: "Dink the keeper", hint: "He is off his line" },
      { id: "dribble", label: "Round him", hint: "Dribbling 13, high risk" },
    ],
  },
  {
    minute: 89, zone: "Left edge", player: { name: "G. Martinelli", pos: "LW", pace: 18, shooting: 13, passing: 12, dribbling: 15 },
    situation: "Added time coming. Full-back on a yellow, crowd roaring.",
    options: [
      { id: "dribble", label: "Skin the full-back", hint: "Pace 18 vs a booked defender" },
      { id: "cross", label: "Stand it up", hint: "Striker attacking the six-yard box" },
      { id: "shoot", label: "Shoot early", hint: "Shooting 13 from distance" },
    ],
  },
  {
    minute: 90, zone: "Halfway", player: { name: "D. Rice", pos: "DM", pace: 13, shooting: 12, passing: 15, dribbling: 12 },
    situation: "Last kick. Everyone forward except the keeper. One launch left.",
    options: [
      { id: "through_ball", label: "Launch it long", hint: "Passing 15 into a crowded box" },
      { id: "hold", label: "Keep the ball", hint: "Protects the point, kills the dream" },
      { id: "dribble", label: "Drive forward", hint: "Legs are gone everywhere" },
    ],
  },
];

const BAND = ["fluffed it", "decent", "SUPERB"] as const;

function narrate(action: string, execution: number, player: string): { text: string; goal: boolean } {
  const superb = execution === 2;
  const decent = execution === 1;
  switch (action) {
    case "shoot":
      return superb ? { text: `GOAL! ${player} fires it in!`, goal: true } : decent ? { text: "Good strike — keeper parries.", goal: false } : { text: "Blazed over the bar.", goal: false };
    case "chip":
      return superb ? { text: `GOAL! ${player} dinks him — sublime!`, goal: true } : decent ? { text: "Deft chip — tipped over!", goal: false } : { text: "Straight at the keeper.", goal: false };
    case "cross":
    case "cross_near":
    case "cross_far":
      return superb ? { text: `Perfect ball — HEADED IN!`, goal: true } : decent ? { text: "Decent cross — headed clear.", goal: false } : { text: "Overhit. Goal kick.", goal: false };
    case "cross_short":
      return superb ? { text: "Worked short — cut back, SCORED!", goal: true } : { text: "Recycled. Nothing on.", goal: false };
    case "dribble":
      return superb ? { text: `${player} past him! Into the box…`, goal: false } : decent ? { text: "Gets by — angle closed down.", goal: false } : { text: "Tackled. Breaks down.", goal: false };
    case "through_ball":
      return superb ? { text: "Sublime pass — clean through, SCORES!", goal: true } : decent ? { text: "Good ball — flag stays down, saved.", goal: false } : { text: "Overhit. Keeper collects.", goal: false };
    default:
      return superb ? { text: "Brave call pays off — crowd loves it.", goal: false } : decent ? { text: "Kept it simple.", goal: false } : { text: "Fizzles out.", goal: false };
  }
}

const ATTRS = ["pace", "shooting", "passing", "dribbling"] as const;

const BEAT_MS = 5200;

/* ── pitch view ────────────────────────────────────────────────
   Top-down match-engine strip. Positions are deterministic per
   beat; the action + execution Jev returns decide where the ball
   and the active player end up. */

type PitchXY = { x: number; y: number };

const ZONE_POS: Record<string, PitchXY> = {
  "Right wing": { x: 66, y: 20 },
  "Centre circle": { x: 44, y: 50 },
  "Corner flag": { x: 86, y: 8 },
  "Penalty spot": { x: 78, y: 50 },
  "Left edge": { x: 62, y: 78 },
  Halfway: { x: 40, y: 55 },
};

const GOAL_MOUTH: PitchXY = { x: 97.5, y: 50 };

interface PitchState {
  player: PitchXY;
  ball: PitchXY;
  runners: [PitchXY, PitchXY];
  defenders: PitchXY[];
  beaten: boolean; // defender left for dead
}

function pitchStateFor(
  b: ScriptBeat,
  answer: TacticAnswer | null,
  pending: boolean
): PitchState {
  const z = ZONE_POS[b.zone] ?? { x: 50, y: 50 };
  const state: PitchState = {
    player: { ...z },
    ball: { ...z },
    runners: [
      { x: 86, y: 42 },
      { x: 86, y: 60 },
    ],
    defenders: [
      { x: Math.min(z.x + 12, 84), y: z.y + (z.y > 50 ? -9 : 9) },
      { x: 82, y: 38 },
      { x: 82, y: 62 },
      { x: 94.5, y: 50 }, // keeper
    ],
    beaten: false,
  };
  if (!answer || pending) return state;

  const ex = answer.execution; // 0 fluff · 1 decent · 2 superb
  switch (answer.action) {
    case "shoot":
      state.ball =
        ex === 2 ? GOAL_MOUTH : ex === 1 ? { x: 93, y: 33 } : { x: 98.5, y: 30 };
      break;
    case "chip":
      state.ball =
        ex === 2 ? GOAL_MOUTH : ex === 1 ? { x: 94, y: 56 } : { x: 98.5, y: 60 };
      break;
    case "dribble":
      state.player = { x: Math.min(z.x + (ex === 2 ? 18 : 12), 90), y: z.y };
      state.ball = { ...state.player };
      state.beaten = ex >= 1;
      break;
    case "cross":
    case "cross_near":
      state.ball = ex === 2 ? { x: 96, y: 46 } : { x: 89, y: 42 };
      state.runners[0] = { x: 90, y: 43 };
      break;
    case "cross_far":
      state.ball = ex === 2 ? { x: 96, y: 54 } : { x: 89, y: 58 };
      state.runners[1] = { x: 90, y: 58 };
      break;
    case "cross_short":
      state.ball = ex === 2 ? { x: 96, y: 50 } : { x: 84, y: 12 };
      if (ex === 2) state.runners[0] = { x: 90, y: 50 };
      break;
    case "through_ball":
      state.ball = ex === 2 ? GOAL_MOUTH : { x: 90, y: 48 };
      state.runners[0] = { x: 89, y: 48 };
      break;
    case "hold":
    default:
      state.ball = { x: z.x - 6, y: z.y };
      state.player = { x: z.x - 4, y: z.y };
      break;
  }
  if (state.beaten) {
    state.defenders[0] = { x: z.x + 2, y: z.y + 6 }; // turned inside out
  }
  return state;
}

function TacticsPitch({
  b,
  answer,
  pending,
  goalFlash,
}: {
  b: ScriptBeat;
  answer: TacticAnswer | null;
  pending: boolean;
  goalFlash: boolean;
}) {
  const s = pitchStateFor(b, answer, pending);
  return (
    <div className="tactics-pitch" aria-label="Pitch view">
      <svg viewBox="0 0 1050 680" preserveAspectRatio="none" className="tactics-pitch-lines">
        <g stroke="rgba(242,245,236,0.28)" strokeWidth="2" fill="none">
          <rect x="8" y="8" width="1034" height="664" />
          <line x1="525" y1="8" x2="525" y2="672" />
          <circle cx="525" cy="340" r="91.5" />
          <rect x="884" y="174" width="158" height="332" />
          <rect x="967" y="264" width="75" height="152" />
          <rect x="8" y="174" width="158" height="332" />
          <rect x="8" y="264" width="75" height="152" />
        </g>
        <rect x="1042" y="294" width="10" height="92" fill="rgba(255,213,106,0.8)" />
      </svg>

      <span className="pitch-zone-tag">
        {b.minute}&prime; · {b.zone}
      </span>

      {/* defenders */}
      {s.defenders.map((d, i) => (
        <span
          key={`d${i}`}
          className={`pitch-dot pitch-dot--away${i === 3 ? " pitch-dot--keeper" : ""}`}
          style={{ left: `${d.x}%`, top: `${d.y}%` }}
        />
      ))}

      {/* runners */}
      {s.runners.map((r, i) => (
        <span
          key={`r${i}`}
          className="pitch-dot pitch-dot--home pitch-dot--runner"
          style={{ left: `${r.x}%`, top: `${r.y}%` }}
        />
      ))}

      {/* active player */}
      <span
        className={`pitch-dot pitch-dot--home pitch-dot--active${pending ? " pitch-dot--thinking" : ""}`}
        style={{ left: `${s.player.x}%`, top: `${s.player.y}%` }}
      >
        <em>{b.player.name.split(" ").pop()}</em>
      </span>

      {/* ball */}
      <span
        className={`pitch-ball${answer && !pending ? " pitch-ball--moving" : ""}`}
        style={{ left: `${s.ball.x}%`, top: `${s.ball.y}%` }}
      />

      {goalFlash && <div className="pitch-goal">GOAL!</div>}
    </div>
  );
}

export default function TacticsPage() {
  const [beat, setBeat] = useState(0);
  const [answer, setAnswer] = useState<TacticAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [home, setHome] = useState(1);
  const [away, setAway] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const [requests, setRequests] = useState(0);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [goalFlash, setGoalFlash] = useState(false);
  const scoredRef = useRef<Set<number>>(new Set());
  const goalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ask = useCallback(async (index: number, h: number, a: number) => {
    const b = SCRIPT[index];
    setPending(true);
    try {
      const res = await fetch("/api/jev-tactics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...b, scoreHome: h, scoreAway: a }),
      });
      const data = (await res.json()) as TacticAnswer;
      setAnswer(data);
      setRequests((r) => r + 1);
      setLatencies((l) => [...l.slice(-11), data.latencyMs]);
      const { text, goal } = narrate(data.action, data.execution, b.player.name);
      setLog((l) => [`${b.minute}' ${text} [${data.actionLabel} · ${BAND[data.execution]} · ${data.latencyMs}ms]`, ...l].slice(0, 6));
      if (goal && !scoredRef.current.has(index)) {
        scoredRef.current.add(index);
        setHome((v) => v + 1);
        setGoalFlash(true);
        if (goalTimer.current) clearTimeout(goalTimer.current);
        goalTimer.current = setTimeout(() => setGoalFlash(false), 2200);
      }
    } catch {
      setLog((l) => [`${b.minute}' Jev unreachable — play safe, keep the ball.`, ...l].slice(0, 6));
    } finally {
      setPending(false);
    }
    void h; void a;
  }, []);

  useEffect(() => {
    if (finished) return;
    void ask(beat, home, away);
    if (beat >= SCRIPT.length - 1) {
      const t = window.setTimeout(() => setFinished(true), BEAT_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, finished]);

  const restart = () => {
    scoredRef.current = new Set();
    setBeat(0); setAnswer(null); setHome(1); setAway(1); setLog([]); setRequests(0); setLatencies([]); setFinished(false);
  };

  const b = SCRIPT[Math.min(beat, SCRIPT.length - 1)];
  const avg = latencies.length ? Math.round(latencies.reduce((x, y) => x + y, 0) / latencies.length) : 0;

  return (
    <main className="tactics">
      <header className="tactics-head">
        <div>
          <p className="eyebrow">Jev · gaffer mode</p>
          <h1>Managed by Jev.</h1>
        </div>
        <div className="tactics-stats">
          <span className={`jev-source jev-source--${answer?.source ?? "idle"}`}>
            {pending ? "deciding…" : answer ? `${answer.source === "jev" ? answer.model ?? "jev" : "heuristic"} · ${answer.latencyMs}ms` : "warming up…"}
          </span>
          <span className="jev-demo-chip">{requests} calls · avg {avg}ms</span>
        </div>
      </header>

      <section className="tactics-board" aria-label="Simulated scoreline">
        <strong>ARS</strong>
        <b>{home}—{away}</b>
        <strong>LIV</strong>
        <span className="tactics-minute" key={b.minute}>{finished ? "FT" : `${b.minute}'`}</span>
        <span className="tactics-script">Simulated passage · every decision by Jev</span>
      </section>

      {!finished ? (
        <div className="tactics-grid">
          <section className="tactics-pitch-wrap" aria-label="Match engine pitch">
            <TacticsPitch b={b} answer={answer} pending={pending} goalFlash={goalFlash} />
          </section>
          <section className="tactics-card" aria-label="Player card" key={b.minute}>
            <p className="eyebrow">{b.player.pos} · {b.zone}</p>
            <h2>{b.player.name}</h2>
            <div className="tactics-attrs">
              {ATTRS.map((attr) => (
                <div className="tactics-attr" key={attr}>
                  <span>{attr.slice(0, 3).toUpperCase()}</span>
                  <div className="tactics-pips" aria-label={`${attr} ${b.player[attr]} of 20`}>
                    {Array.from({ length: 20 }, (_, i) => (
                      <i key={i} className={i < b.player[attr] ? "on" : ""} />
                    ))}
                  </div>
                  <b>{b.player[attr]}</b>
                </div>
              ))}
            </div>
            <p className="tactics-situation">{b.situation}</p>
            {answer && (
              <p className="tactics-call" key={`${beat}-${answer.action}`}>
                JEV SAYS: <strong>{answer.actionLabel.toUpperCase()}</strong> · {BAND[answer.execution]} · conf {Math.round(answer.confidence * 100)}%
                {answer.executionProbs && (
                  <span className="tactics-call-probs">
                    odds — fluff {Math.round((answer.executionProbs["0"] ?? 0) * 100)}% · decent {Math.round((answer.executionProbs["1"] ?? 0) * 100)}% · superb {Math.round((answer.executionProbs["2"] ?? 0) * 100)}%
                  </span>
                )}
              </p>
            )}
          </section>
          <section className="tactics-feed" aria-label="Commentary" aria-live="polite">
            <p className="eyebrow">Commentary</p>
            {log.length === 0 && <p className="tactics-feed-idle">Jev is reading the game…</p>}
            {log.map((line, i) => (
              <p key={`${i}-${line}`} className={i === 0 ? "tactics-feed-latest" : ""}>{line}</p>
            ))}
          </section>
        </div>
      ) : (
        <section className="tactics-fulltime">
          <h2>FULL TIME {home}—{away}</h2>
          <p>{requests} decisions · avg {avg}ms · every call by Jev, graded live.</p>
          <button type="button" onClick={restart}>Run it again →</button>
        </section>
      )}
    </main>
  );
}
