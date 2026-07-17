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
  merkleProof: string[];
  statement: string;
  anchoredRoot: string;
  verifiedAt: string;
  outcome: Outcome;
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
