/**
 * Quant layer type contracts.
 *
 * PricingSnapshot is the canonical, hashable match-state shape that the
 * agent prices from and that the onchain attestation anchors. It is the
 * shared contract across all three owners: quant prices from it, the
 * onchain attestation stores its hash, and the UI reconstructs + verifies
 * it. Changing a field here changes the anchored-hash space — bump
 * ModelParams.version when you do.
 */

import type { MarketPredicate } from "@stoppage/sdk";

export interface ScoreState {
  home: number;
  away: number;
}
export interface CornersState {
  home: number;
  away: number;
}
export interface CardsState {
  homeYellow: number;
  homeRed: number;
  awayYellow: number;
  awayRed: number;
}

/**
 * The match state at pricing time. Every field is what the TxLINE feed
 * observed at (seq, ts); the onchain Merkle proof anchors the stat at that
 * seq, so a verifier can confirm this snapshot came from real TxLINE data.
 */
export interface PricingSnapshot {
  matchId: string;
  fixtureId: number;
  /** Elapsed match minutes, 0..90+ (includes stoppage already played). */
  minute: number;
  score: ScoreState;
  corners: CornersState;
  cards: CardsState;
  /** TxLINE score-record sequence at this snapshot (for Merkle anchor). */
  seq: number;
  /** TxLINE timestamp (ms) at this snapshot (for Merkle anchor alignment). */
  ts: number;
}

/**
 * The output of pricing. `fairValue` is P(over threshold) in [0,1].
 * `bid`/`ask` are the market-maker quotes around it. `ci` is the 95% CI
 * on the probability; `sims` is the simulation count. `modelVersion` +
 * `seed` make the result reproducible: re-run priceMarket with the same
 * (predicate, snapshot, params with this version, seed) and you get the
 * same fairValue, bid, ask — that is the no-black-box property.
 */
export interface PricingResult {
  fairValue: number;
  bid: number;
  ask: number;
  ci: [number, number];
  sims: number;
  modelVersion: string;
  seed: string;
}

/** A single observed (predicted probability, actual outcome) pair. */
export interface CalibrationPoint {
  /** Predicted probability of "yes", in [0,1]. */
  p: number;
  /** Whether "yes" actually occurred. */
  outcome: boolean;
}

export interface CalibrationBucket {
  /** Lower bound of the probability bucket, inclusive. */
  lo: number;
  /** Upper bound of the probability bucket, exclusive (last is inclusive). */
  hi: number;
  /** Mean predicted p in this bucket. */
  predicted: number;
  /** Empirical frequency of yes in this bucket. */
  actual: number;
  /** Sample count in this bucket. */
  count: number;
}

export interface CalibrationReport {
  /** Mean Brier score (lower is better; 0 = perfect, 0.25 = no-skill 50/50). */
  brier: number;
  /** Mean log loss (lower is better). */
  logLoss: number;
  buckets: CalibrationBucket[];
  n: number;
}

export type { MarketPredicate };
