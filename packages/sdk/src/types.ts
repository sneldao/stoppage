/**
 * Shared types for the Stoppage protocol SDK.
 * Kept deliberately small at scaffold stage — grow this as the predicate
 * library and settlement program stabilize.
 */

export type MatchId = string; // TxLINE match identifier

export type PredicateKind =
  | "next_goal_within"
  | "corners_over"
  | "card_shown"
  | "total_goals_over";

export interface MarketPredicate {
  kind: PredicateKind;
  matchId: MatchId;
  /** Predicate-specific parameters, e.g. { team: "FRA", windowSeconds: 600 } */
  params: Record<string, string | number>;
}

export interface Market {
  id: string;
  predicate: MarketPredicate;
  /** Vault PDA holding staked funds for this market. */
  vaultAddress: string;
  createdAt: string;
  /** ISO timestamp after which no new positions can be opened. */
  closesAt: string;
  status: "open" | "awaiting_settlement" | "settled" | "void";
}

export interface Position {
  marketId: string;
  owner: string; // wallet pubkey (the *authority*, not necessarily the signer)
  side: "yes" | "no";
  amountLamports: number;
  openedViaSessionKey: boolean;
  txSignature: string;
}

export interface SettlementProof {
  marketId: string;
  matchId: MatchId;
  /** Raw Merkle proof as returned by TxLINE's validation primitive. */
  merkleProof: string[];
  /** The leaf/statement being proven, e.g. "GOAL:FRA:63:00". */
  statement: string;
  /** Root anchored on Solana, per TxLINE's docs. */
  anchoredRoot: string;
  verifiedAt: string;
  outcome: "yes" | "no" | "void";
}

export interface SessionKeyGrant {
  owner: string; // wallet pubkey that authorized the delegation
  sessionPubkey: string;
  /** Programs this session key is allowed to invoke. Keep this tight. */
  allowedPrograms: string[];
  maxStakeLamportsPerMarket: number;
  expiresAt: string;
  revoked: boolean;
}
