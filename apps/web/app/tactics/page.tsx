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
  const scoredRef = useRef<Set<number>>(new Set());

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
