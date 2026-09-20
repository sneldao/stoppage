/**
 * Jev Mind API — advisory-only live reads for the match room.
 *
 * Hard boundary: this route never creates, settles, or verifies a market.
 * It returns fast System One judgments (Score/Score/Score/Boolean mapped
 * to 0-1 bars) that the UI renders next to the deterministic proof path.
 * Settlement truth stays on-chain; Jev only narrates momentum.
 *
 * Precedence (gateway free promo till 2026-09-25, then flip back):
 *   1. Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model `typesafe-ai/jev`,
 *      via `experimental_evaluate` from the AI SDK, zero data retention).
 *   2. Direct TypeSafe API (`TYPESAFE_API_KEY`, model `jev-latest`).
 *   3. Deterministic heuristic, labeled source=heuristic so the UI never
 *      impersonates Jev.
 */

import { NextResponse } from "next/server";
import { experimental_evaluate as evaluate } from "ai";

export interface JevMindRead {
  id: string;
  label: string;
  /** 0-1 bar value */
  value: number;
  /** 0-1, when the backend reports it */
  confidence: number;
  note: string;
}

export interface JevMindResponse {
  source: "jev" | "heuristic";
  model: string | null;
  latencyMs: number;
  reads: JevMindRead[];
}

interface JevMindRequest {
  matchId?: string | null;
  home?: string | null;
  away?: string | null;
  scoreHome?: number;
  scoreAway?: number;
  corners?: number;
  cards?: number;
  openMarkets?: number;
  yesShare?: number | null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function heuristicReads(body: JevMindRequest): JevMindRead[] {
  const goals = (body.scoreHome ?? 0) + (body.scoreAway ?? 0);
  const corners = body.corners ?? 0;
  const cards = body.cards ?? 0;
  const goalPressure = clamp01(0.12 + goals * 0.22 + corners * 0.02 + cards * 0.03);
  const cornersPressure = clamp01(corners / 10 + cards * 0.02);
  const chaos = clamp01(corners / 12 + cards / 6 + goals * 0.12);
  // Heuristic has no signal for feed inconsistency — report calm honestly.
  return [
    { id: "goal_pressure", label: "Goal pressure", value: goalPressure, confidence: 0.5, note: "heuristic fallback" },
    { id: "corners_pressure", label: "Corners pressure", value: cornersPressure, confidence: 0.5, note: "heuristic fallback" },
    { id: "chaos", label: "Chaos", value: chaos, confidence: 0.5, note: "heuristic fallback" },
    { id: "feed_anomaly", label: "Feed anomaly", value: 0.05, confidence: 0.5, note: "heuristic fallback" },
  ];
}

function buildState(body: JevMindRequest) {
  return {
    match: { id: body.matchId ?? null, home: body.home ?? null, away: body.away ?? null },
    score: { home: body.scoreHome ?? 0, away: body.scoreAway ?? 0 },
    stats: { corners: body.corners ?? 0, cards: body.cards ?? 0 },
    market: { openMarkets: body.openMarkets ?? 0, yesShare: body.yesShare ?? null },
  };
}

const GOAL_LEVELS = [
  "Quiet, no threat building",
  "Building, early signs of pressure",
  "Sustained pressure, chance feels near",
  "Imminent, a goal looks seconds away",
];

const CORNERS_LEVELS = [
  "No wide pressure",
  "Some wide play",
  "Heavy wide pressure",
  "Relentless, corners keep coming",
];

const CHAOS_LEVELS = ["Controlled", "Lively but structured", "Chaotic, anything can happen"];

/** Path 1 — Vercel AI Gateway (primary while the promo is free). */
async function gatewayReads(body: JevMindRequest): Promise<{ model: string; reads: JevMindRead[] }> {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state: buildState(body),
    questions: {
      goal_pressure: {
        type: "score",
        instructions: "How much goal pressure does `score` + `stats` show right now?",
        criteria: GOAL_LEVELS,
      },
      corners_pressure: {
        type: "score",
        instructions: "How much corners pressure does `stats.corners` show?",
        criteria: CORNERS_LEVELS,
      },
      chaos: {
        type: "score",
        instructions: "How chaotic is this match given `score` and `stats`?",
        criteria: CHAOS_LEVELS,
      },
      feed_anomaly: {
        type: "boolean",
        instructions: "The score or stats look inconsistent or suspicious for a live football match",
      },
    },
    // Note: providerOptions.gateway.zeroDataRetention is intentionally
    // unset — ZDR requires a Pro/Enterprise plan and this key is hobby.
    // Re-add `{ gateway: { zeroDataRetention: true } }` after upgrading.
    abortSignal: AbortSignal.timeout(8000),
  });

  const answers = result.answers as Record<string, { score?: number; probability?: number }>;
  const confidence = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
  const norm = (score: number | undefined, levels: number) =>
    clamp01((score ?? 0) / Math.max(1, levels - 1));
  const conf = (id: string) => clamp01(Number(confidence[id] ?? 0.5));
  return {
    model: "typesafe-ai/jev (gateway)",
    reads: [
      { id: "goal_pressure", label: "Goal pressure", value: norm(answers.goal_pressure?.score, 4), confidence: conf("goal_pressure"), note: "jev score via gateway" },
      { id: "corners_pressure", label: "Corners pressure", value: norm(answers.corners_pressure?.score, 4), confidence: conf("corners_pressure"), note: "jev score via gateway" },
      { id: "chaos", label: "Chaos", value: norm(answers.chaos?.score, 3), confidence: conf("chaos"), note: "jev score via gateway" },
      { id: "feed_anomaly", label: "Feed anomaly", value: clamp01(Number(answers.feed_anomaly?.probability ?? 0)), confidence: 0.5, note: "jev boolean via gateway" },
    ],
  };
}

/** Path 2 — direct TypeSafe API (fallback once the gateway promo ends). */
async function directReads(body: JevMindRequest, apiKey: string): Promise<{ model: string; reads: JevMindRead[] }> {
  const questions = {
    goal_pressure: {
      type: "score",
      instructions: "How much goal pressure does `score` + `stats` show right now?",
      criteria: GOAL_LEVELS,
    },
    corners_pressure: {
      type: "score",
      instructions: "How much corners pressure does `stats.corners` show?",
      criteria: CORNERS_LEVELS,
    },
    chaos: {
      type: "score",
      instructions: "How chaotic is this match given `score` and `stats`?",
      criteria: CHAOS_LEVELS,
    },
    feed_anomaly: {
      type: "noul",
      instructions: "The score or stats look inconsistent or suspicious for a live football match",
    },
  };
  const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: buildState(body), model: "jev-latest", questions }),
    signal: AbortSignal.timeout(8000),
  });
  if (!upstream.ok) throw new Error(`typesafe ${upstream.status}`);
  const data = (await upstream.json()) as {
    model?: string;
    answers?: Record<string, { score?: number; noul?: number; confidence?: number }>;
  };
  const answers = data.answers ?? {};
  const norm = (score: number | undefined, levels: number) =>
    clamp01(((score ?? 0) as number) / Math.max(1, levels - 1));
  const conf = (id: string) => clamp01(Number(answers[id]?.confidence ?? 0.5));
  return {
    model: `${data.model ?? "jev-latest"} (direct)`,
    reads: [
      { id: "goal_pressure", label: "Goal pressure", value: norm(answers.goal_pressure?.score, 4), confidence: conf("goal_pressure"), note: "jev score direct" },
      { id: "corners_pressure", label: "Corners pressure", value: norm(answers.corners_pressure?.score, 4), confidence: conf("corners_pressure"), note: "jev score direct" },
      { id: "chaos", label: "Chaos", value: norm(answers.chaos?.score, 3), confidence: conf("chaos"), note: "jev score direct" },
      { id: "feed_anomaly", label: "Feed anomaly", value: clamp01(Number(answers.feed_anomaly?.noul ?? 0)), confidence: 0.5, note: "jev noul direct" },
    ],
  };
}

export async function POST(req: Request) {
  const started = Date.now();
  let body: JevMindRequest = {};
  try {
    body = (await req.json()) as JevMindRequest;
  } catch {
    body = {};
  }

  // 1. Gateway primary (free promo).
  if (process.env.AI_GATEWAY_API_KEY) {
    try {
      const { model, reads } = await gatewayReads(body);
      return NextResponse.json(
        { source: "jev", model, latencyMs: Date.now() - started, reads } satisfies JevMindResponse,
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      // Fall through to direct, then heuristic — advisory must never fail.
    }
  }

  // 2. Direct fallback (ours).
  if (process.env.TYPESAFE_API_KEY) {
    try {
      const { model, reads } = await directReads(body, process.env.TYPESAFE_API_KEY);
      return NextResponse.json(
        { source: "jev", model, latencyMs: Date.now() - started, reads } satisfies JevMindResponse,
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      // Fall through to heuristic.
    }
  }

  // 3. Heuristic, honestly labeled.
  return NextResponse.json(
    { source: "heuristic", model: null, latencyMs: Date.now() - started, reads: heuristicReads(body) } satisfies JevMindResponse,
    { headers: { "Cache-Control": "no-store" } }
  );
}
