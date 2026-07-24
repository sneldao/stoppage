/**
 * Shared types for the Stoppage protocol SDK.
 * Kept deliberately small — grow this as the predicate library and
 * settlement program stabilize. On-chain account layouts are defined
 * in the IDL (packages/sdk/idl/); these TS types mirror them for
 * client-side ergonomics.
 */

export type MatchId = string; // TxLINE match identifier

export type PredicateKind =
  | "next_goal_within"
  | "corners_over"
  | "card_shown"
  | "total_goals_over";

/** Numeric encoding of PredicateKind on-chain (u8). */
export const PREDICATE_KIND: Record<PredicateKind, number> = {
  next_goal_within: 0,
  corners_over: 1,
  card_shown: 2,
  total_goals_over: 3,
};

/** Human-readable labels for each PredicateKind (single source of truth). */
export const PREDICATE_LABEL: Record<PredicateKind, string> = {
  next_goal_within: "Next goal within",
  corners_over: "Corners over",
  card_shown: "Card shown",
  total_goals_over: "Total goals over",
};

export interface MarketPredicate {
  kind: PredicateKind;
  matchId: MatchId;
  /** Predicate-specific parameters, e.g. { team: "FRA", windowSeconds: 600 } */
  params: Record<string, string | number>;
}

export type MarketStatus = "open" | "awaiting_settlement" | "settled" | "void";
export type Outcome = "yes" | "no" | "void";
export type Side = "yes" | "no";

export const STATUS: Record<MarketStatus, number> = {
  open: 0,
  awaiting_settlement: 1,
  settled: 2,
  void: 3,
};

export const STATUS_FROM_NUM: Record<number, MarketStatus> = {
  0: "open",
  1: "awaiting_settlement",
  2: "settled",
  3: "void",
};

export const OUTCOME_FROM_NUM: Record<number, Outcome> = {
  0: "yes",
  1: "no",
  2: "void",
};

export interface Market {
  id: string;
  predicate: MarketPredicate;
  creator: string;
  oracle: string;
  bondLamports: number;
  bondClaimed: boolean;
  yesPool: number;
  noPool: number;
  closesAt: string;
  settlesAt: string | null;
  status: MarketStatus;
  outcome: Outcome;
  feeBps: number;
  verifications: number;
}

export interface Position {
  marketId: string;
  owner: string;
  side: Side;
  amountLamports: number;
  openedViaSessionKey: boolean;
}

export interface SettlementProof {
  marketId: string;
  matchId: MatchId;
  statement: string;
  anchoredRoot: string | number[];
  verifiedAt: string;
  outcome: Outcome;
  /** The TxLINE fixture ID. */
  fixtureId: number;
  /** Score record sequence number from the observed update. */
  seq: number;
  /** Timestamp (ms) of the score update — used for PDA derivation. */
  timestamp: number;
  /** The stat that was proven (key + value). */
  statKey: number;
  statValue: number;
  /** Merkle proof path from leaf to root (normalized 32-byte hashes). */
  statProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
  /** Merkle proof for the fixture subtree. */
  subTreeProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
  /** Merkle proof for the main tree. */
  mainTreeProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
  /** The event stat root (hex string or byte array from TxLINE API). */
  eventStatRoot: string | number[];
  /** The fixture subtree root (hex string or byte array from TxLINE API). */
  subTreeRoot: string | number[];
}

export interface SessionKeyGrant {
  owner: string;
  sessionPubkey: string;
  allowedPrograms: string[];
  maxStakePerMarket: number;
  /** Cumulative spend cap = loss limit (rule 9). */
  maxTotalStake: number;
  stakedSoFar: number;
  expiresAt: string;
  revoked: boolean;
}

export interface ProtocolConfig {
  authority: string;
  feeBps: number;
  treasury: string;
}

export interface AgentAuthority {
  authority: string;
}

/**
 * Output of the verifiable quant model. `priceMarket(predicate, snapshot,
 * params, seed)` returns this. The CI + sims + seed make the quoted fair
 * value reproducible off-chain (the "no black box" re-run), while bid/ask are
 * what the agent publishes as a live reference line.
 */
export interface PricingResult {
  /** Fair value of YES, 0..1. */
  fairValue: number;
  bid: number;
  ask: number;
  /** Confidence interval [low, high] on fairValue from Monte Carlo CI width. */
  ci: [number, number];
  /** Monte Carlo simulation count used. */
  sims: number;
  /** Model version string (committed in packages/quant). */
  modelVersion: string;
  /** Deterministic seed used — required to reproduce this exact quote. */
  seed: string;
}

/** Input to the quant model — must be byte-identical on-chain and off-chain. */
export interface PricingSnapshot {
  matchId: string;
  fixtureId: number;
  minute: number;
  score: { home: number; away: number };
  corners: { home: number; away: number };
  cards: {
    homeYellow: number;
    homeRed: number;
    awayYellow: number;
    awayRed: number;
  };
  seq: number;
  ts: number;
}

/** A committed, verifiable quote from the agent. */
export interface PricingReceipt {
  market: string;
  snapshotHash: string;
  modelVersion: string;
  fairValue: number;
  bid: number;
  ask: number;
  agentSignature: string;
  ts: number;
}
