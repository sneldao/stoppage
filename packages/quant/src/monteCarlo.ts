/**
 * Monte Carlo simulator — the quant brain's generative core.
 *
 * Models goals and corners as Poisson processes: the expected count of
 * remaining events is λ_per_minute * minutesRemaining, where λ blends the
 * match's own observed pace with a league prior (more observed minutes =>
 * more weight on the match's own pace). Simulates the remainder N times and
 * counts threshold exceedances => P(over).
 *
 * Determinism: the RNG stream is seeded from (seed, predicate.kind,
 * threshold, hashSnapshot(snapshot)). Same inputs => same stream => same
 * probability, on any machine. That is the reproducibility contract.
 */

import type { MarketPredicate } from "@stoppage/sdk";
import type { ModelParams } from "./modelParams";
import type { PricingSnapshot } from "./types";
import { hashSeed, mulberry32, poisson } from "./rng";
import { hashSnapshot } from "./snapshot";

export interface SimulationResult {
  /** P(over threshold) in [0,1]. */
  probability: number;
  /** 95% confidence interval on the probability (normal approx). */
  ci: [number, number];
  /** Number of simulations run. */
  sims: number;
}

function thresholdFor(predicate: MarketPredicate): number {
  const t = predicate.params.threshold;
  const n = typeof t === "number" ? t : Number(t ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function minutesRemaining(snapshot: PricingSnapshot, params: ModelParams): number {
  // 90 + stoppage allowance, minus elapsed; floored at the allowance so a
  // match at minute 90 still has the stoppage window left to simulate.
  return Math.max(90 + params.stoppageMinutes - snapshot.minute, params.stoppageMinutes);
}

function blendedRatePerMinute(
  observedSoFar: number,
  priorPerMatch: number,
  snapshot: PricingSnapshot,
  params: ModelParams,
): number {
  const observedPerMinute = snapshot.minute > 0 ? observedSoFar / snapshot.minute : 0;
  const frac = Math.min(Math.max(snapshot.minute / 90, 0), 1);
  const w = params.blendMin + (params.blendMax - params.blendMin) * frac;
  return w * observedPerMinute + (1 - w) * (priorPerMatch / 90);
}

export function simulate(
  predicate: MarketPredicate,
  snapshot: PricingSnapshot,
  params: ModelParams,
  seed: string,
): SimulationResult {
  const threshold = thresholdFor(predicate);
  const remaining = minutesRemaining(snapshot, params);
  const rng = mulberry32(
    hashSeed(seed, predicate.kind, String(threshold), hashSnapshot(snapshot)),
  );

  let observedSoFar: number;
  let priorPerMatch: number;
  switch (predicate.kind) {
    case "total_goals_over":
      observedSoFar = snapshot.score.home + snapshot.score.away;
      priorPerMatch = params.goalRatePrior;
      break;
    case "corners_over":
      observedSoFar = snapshot.corners.home + snapshot.corners.away;
      priorPerMatch = params.cornerRatePrior;
      break;
    default:
      // next_goal_within / card_shown need a different generative model
      // (time-to-event / card accumulation). Refuse rather than mislead.
      throw new Error(
        `quant: unsupported predicate kind "${predicate.kind}" — only total_goals_over and corners_over are priced`,
      );
  }

  const lambdaPerMinute = blendedRatePerMinute(observedSoFar, priorPerMatch, snapshot, params);
  const lambdaRemaining = lambdaPerMinute * remaining;

  const N = Math.max(1, params.simulations);
  let exceedances = 0;
  for (let i = 0; i < N; i++) {
    const future = poisson(rng, lambdaRemaining);
    if (observedSoFar + future > threshold) exceedances++;
  }

  const p = exceedances / N;
  const sd = Math.sqrt((p * (1 - p)) / N);
  const ci: [number, number] = [
    Math.max(0, p - 1.96 * sd),
    Math.min(1, p + 1.96 * sd),
  ];
  return { probability: p, ci, sims: N };
}
