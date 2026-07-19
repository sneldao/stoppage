/**
 * Pricing facade + calibration backtest — the public quant API.
 *
 * priceMarket is the single entry point the agent and UI both call. It is
 * a pure deterministic function of (predicate, snapshot, params, seed, inventory):
 * same inputs => same PricingResult, anywhere. The onchain attestation
 * stores (snapshotHash, modelVersion, fairValue, bid, ask); a verifier
 * re-runs this function against the anchored snapshot and checks the result
 * matches — that closes the no-black-box loop.
 *
 * backtest turns a list of (predicted p, actual outcome) into a calibration
 * report (Brier, log loss, reliability buckets). It powers the public
 * calibration leaderboard: "were the model's quoted probabilities right?"
 */

import type { MarketPredicate } from "@stoppage/sdk";
import { DEFAULT_MODEL_PARAMS, type ModelParams } from "./modelParams";
import type {
  CalibrationBucket,
  CalibrationPoint,
  CalibrationReport,
  PricingResult,
  PricingSnapshot,
} from "./types";
import { simulate } from "./monteCarlo";
import { makeQuote, type Inventory } from "./marketMaker";

export function priceMarket(
  predicate: MarketPredicate,
  snapshot: PricingSnapshot,
  params: ModelParams = DEFAULT_MODEL_PARAMS,
  seed: string,
  inventory: Inventory = { netYes: 0, notional: 1 },
): PricingResult {
  const sim = simulate(predicate, snapshot, params, seed);
  const quote = makeQuote(sim.probability, sim.ci, params, inventory);
  return {
    fairValue: quote.fairValue,
    bid: quote.bid,
    ask: quote.ask,
    ci: sim.ci,
    sims: sim.sims,
    modelVersion: params.version,
    seed,
  };
}

const CALIBRATION_BUCKETS = 10;

export function backtest(points: CalibrationPoint[]): CalibrationReport {
  const n = points.length;
  if (n === 0) return { brier: 0, logLoss: 0, buckets: [], n: 0 };

  const buckets: CalibrationBucket[] = [];
  for (let b = 0; b < CALIBRATION_BUCKETS; b++) {
    buckets.push({
      lo: b / CALIBRATION_BUCKETS,
      hi: (b + 1) / CALIBRATION_BUCKETS,
      predicted: 0,
      actual: 0,
      count: 0,
    });
  }

  let brier = 0;
  let logLoss = 0;
  for (const { p, outcome } of points) {
    const o = outcome ? 1 : 0;
    brier += (p - o) ** 2;
    const pc = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    logLoss += -(o * Math.log(pc) + (1 - o) * Math.log(1 - pc));
    const idx = Math.min(
      CALIBRATION_BUCKETS - 1,
      Math.max(0, Math.floor(p * CALIBRATION_BUCKETS)),
    );
    buckets[idx].count++;
    buckets[idx].predicted += p;
    buckets[idx].actual += o;
  }

  for (const b of buckets) {
    b.predicted = b.count ? b.predicted / b.count : 0;
    b.actual = b.count ? b.actual / b.count : 0;
  }

  return { brier: brier / n, logLoss: logLoss / n, buckets, n };
}
