/**
 * Jev tactics API — Championship-Manager-style decisions, called by Jev.
 *
 * Advisory/demo only: each request sends one match situation (player
 * attributes 1–20, zone, scoreline) and gets back a Choice (the action)
 * plus a Score (execution quality). The page narrates from those answers.
 * Nothing here touches markets, betting, or settlement.
 *
 * Precedence mirrors /api/jev-mind: Vercel AI Gateway → direct TypeSafe
 * API → deterministic heuristic, always labeled. Server-only keys.
 */

import { NextResponse } from "next/server";
import { experimental_evaluate as evaluate } from "ai";

export interface TacticOption {
  id: string;
  label: string;
  /** Why this option fits the situation — read by the model. */
  hint: string;
}

export interface TacticBeat {
  minute: number;
  scoreHome: number;
  scoreAway: number;
  zone: string;
  player: { name: string; pos: string; pace: number; shooting: number; passing: number; dribbling: number };
  situation: string;
  options: TacticOption[];
}

export interface TacticAnswer {
  source: "jev" | "heuristic";
  model: string | null;
  latencyMs: number;
  action: string;
  actionLabel: string;
  probabilities: Record<string, number>;
  confidence: number;
  /** 0 = fluffed it, 1 = decent, 2 = superb */
  execution: number;
  /** Jev's outcome distribution over [fluffed, decent, superb] — execution is sampled from this. */
  executionProbs?: Record<string, number>;
}

/** Sample a band index from Jev's outcome distribution; falls back to rounding the point score. */
function sampleExecution(a: { score?: number; probabilities?: Record<string, number> } | undefined): { execution: number; executionProbs?: Record<string, number> } {
  const probs = a?.probabilities;
  if (probs && Object.keys(probs).length) {
    const p0 = clamp01(Number(probs["0"] ?? 0));
    const p1 = clamp01(Number(probs["1"] ?? 0));
    const p2 = clamp01(Number(probs["2"] ?? 0));
    const total = p0 + p1 + p2;
    if (total > 0) {
      const roll = Math.random() * total;
      const execution = roll < p0 ? 0 : roll < p0 + p1 ? 1 : 2;
      return { execution, executionProbs: { "0": p0 / total, "1": p1 / total, "2": p2 / total } };
    }
  }
  return { execution: Math.max(0, Math.min(2, Math.round(Number(a?.score ?? 1)))) };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function criteriaFor(beat: TacticBeat): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const o of beat.options) entries[o.id] = `${o.label}: ${o.hint}`;
  return entries;
}

function stateFor(beat: TacticBeat) {
  return {
    minute: beat.minute,
    score: { home: beat.scoreHome, away: beat.scoreAway },
    zone: beat.zone,
    situation: beat.situation,
    player: beat.player,
  };
}

async function gatewayAnswer(beat: TacticBeat): Promise<Omit<TacticAnswer, "source" | "model" | "latencyMs">> {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state: stateFor(beat),
    questions: {
      action: {
        type: "choice",
        instructions: `What should ${beat.player.name} (${beat.player.pos}) do in \`situation\`, given \`player\` attributes (1-20)?`,
        criteria: criteriaFor(beat),
      },
      execution: {
        type: "score",
        instructions: "How well does he execute the chosen action?",
        criteria: ["Fluffed it", "Decent effort", "Superb"],
      },
    },
    abortSignal: AbortSignal.timeout(8000),
  });
  const answers = result.answers as Record<string, { choice?: string; probabilities?: Record<string, number>; score?: number }>;
  const confidence = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
  const action = answers.action?.choice ?? beat.options[0].id;
  const opt = beat.options.find((o) => o.id === action) ?? beat.options[0];
  return {
    action: opt.id,
    actionLabel: opt.label,
    probabilities: answers.action?.probabilities ?? {},
    confidence: clamp01(Number(confidence.action ?? 0.5)),
    ...sampleExecution(answers.execution),
  };
}

async function directAnswer(beat: TacticBeat, apiKey: string): Promise<Omit<TacticAnswer, "source" | "model" | "latencyMs">> {
  const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      state: stateFor(beat),
      model: "jev-latest",
      questions: {
        action: {
          type: "choice",
          instructions: `What should ${beat.player.name} (${beat.player.pos}) do in the situation, given player attributes (1-20)?`,
          criteria: Object.fromEntries(beat.options.map((o) => [o.id, `${o.label}: ${o.hint}`])),
        },
        execution: {
          type: "score",
          instructions: "How well does he execute the chosen action?",
          criteria: ["Fluffed it", "Decent effort", "Superb"],
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!upstream.ok) throw new Error(`typesafe ${upstream.status}`);
  const data = (await upstream.json()) as {
    model?: string;
    answers?: Record<string, { choice?: string; probabilities?: Record<string, number>; score?: number; confidence?: number }>;
  };
  const answers = data.answers ?? {};
  const action = answers.action?.choice ?? beat.options[0].id;
  const opt = beat.options.find((o) => o.id === action) ?? beat.options[0];
  void data.model;
  return {
    action: opt.id,
    actionLabel: opt.label,
    probabilities: answers.action?.probabilities ?? {},
    confidence: clamp01(Number(answers.action?.confidence ?? 0.5)),
    ...sampleExecution(answers.execution),
  };
}

/** Deterministic fallback: play to the player's best attribute. */
function heuristicAnswer(beat: TacticBeat): Omit<TacticAnswer, "source" | "model" | "latencyMs"> {
  const p = beat.player;
  const ranked: Array<[string, number]> = [
    ["shoot", p.shooting],
    ["dribble", p.dribbling],
    ["cross", p.passing],
    ["through_ball", p.passing],
  ];
  let best = beat.options[0].id;
  let bestScore = -1;
  for (const o of beat.options) {
    const s = ranked.find(([id]) => o.id.includes(id))?.[1] ?? 10;
    if (s > bestScore) { bestScore = s; best = o.id; }
  }
  const opt = beat.options.find((o) => o.id === best) ?? beat.options[0];
  return { action: opt.id, actionLabel: opt.label, probabilities: {}, confidence: 0.5, execution: 1 };
}

export async function POST(req: Request) {
  const started = Date.now();
  let beat: TacticBeat;
  try {
    beat = (await req.json()) as TacticBeat;
    if (!beat || !Array.isArray(beat.options) || beat.options.length === 0) throw new Error("bad beat");
  } catch {
    return NextResponse.json({ error: "invalid beat" }, { status: 400 });
  }

  if (process.env.AI_GATEWAY_API_KEY) {
    try {
      const a = await gatewayAnswer(beat);
      return NextResponse.json(
        { source: "jev", model: "typesafe-ai/jev (gateway)", latencyMs: Date.now() - started, ...a } satisfies TacticAnswer,
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch { /* fall through */ }
  }
  if (process.env.TYPESAFE_API_KEY) {
    try {
      const a = await directAnswer(beat, process.env.TYPESAFE_API_KEY);
      return NextResponse.json(
        { source: "jev", model: "jev-latest (direct)", latencyMs: Date.now() - started, ...a } satisfies TacticAnswer,
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch { /* fall through */ }
  }
  const a = heuristicAnswer(beat);
  return NextResponse.json(
    { source: "heuristic", model: null, latencyMs: Date.now() - started, ...a } satisfies TacticAnswer,
    { headers: { "Cache-Control": "no-store" } }
  );
}
