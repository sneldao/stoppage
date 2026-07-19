/**
 * @stoppage/quant — the verifiable in-play quant layer for Stoppage.
 *
 * Pure TS. No I/O, no chain, no React. The model is a pure deterministic
 * function of (predicate, snapshot, params, seed), so any quoted fair value
 * is reproducible by anyone — the offchain half of the no-black-box proof.
 *
 * Public surface:
 *   priceMarket(predicate, snapshot, params?, seed, inventory?) -> PricingResult
 *   backtest(points) -> CalibrationReport
 *   makeQuote(fairValue, ci, params, inventory?) -> Quote
 *   kellyFraction(p, decimalOdds) -> number
 *   simulate(predicate, snapshot, params, seed) -> SimulationResult
 *   hashSnapshot(snapshot) -> string
 *
 * See modelParams.ts for the published open model assumptions.
 */

export type {
  CalibrationBucket,
  CalibrationPoint,
  CalibrationReport,
  CardsState,
  CornersState,
  PricingResult,
  PricingSnapshot,
  ScoreState,
} from "./types";
export type { ModelParams } from "./modelParams";
export type { Inventory, Quote } from "./marketMaker";
export type { SimulationResult } from "./monteCarlo";

export { DEFAULT_MODEL_PARAMS } from "./modelParams";
export { backtest, priceMarket } from "./pricing";
export { kellyFraction, makeQuote } from "./marketMaker";
export { simulate } from "./monteCarlo";
export { hashSnapshot, canonicalSnapshotJson } from "./snapshot";
export { deriveSeed } from "./seed";
export { hashSeed, mulberry32, poisson } from "./rng";

// Re-export the predicate contract so consumers can import it from one place.
export type { MarketPredicate, PredicateKind } from "@stoppage/sdk";
