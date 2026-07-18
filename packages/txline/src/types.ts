/**
 * TxLINE domain types — derived from the TxLINE API docs.
 *
 * These types model the data that flows through the system:
 * fixtures, score events, stat keys, game phases, and validation proofs.
 * They are the single source of truth for TxLINE data shapes across
 * the agent and the web app (rule 6 — one implementation per concern).
 */

// ── Network config ──────────────────────────────────────────────────

export type Network = "mainnet" | "devnet";

export interface NetworkConfig {
  rpcUrl: string;
  apiOrigin: string;
  programId: string;
  txlTokenMint: string;
}

// ── Fixtures ────────────────────────────────────────────────────────

export interface Fixture {
  FixtureId: number;
  Sport: string;
  Country: string;
  FixtureGroup: string;
  StartTime: string; // ISO timestamp
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  GameState: number; // 1 = scheduled, 6 = cancelled
}

// ── Game phases (soccer) ────────────────────────────────────────────

export enum GamePhase {
  NotStarted = 1,
  FirstHalf = 2,
  Halftime = 3,
  SecondHalf = 4,
  Finished = 5,
  WaitingExtraTime = 6,
  ExtraTimeFirstHalf = 7,
  ExtraTimeHalftime = 8,
  ExtraTimeSecondHalf = 9,
  FinishedExtraTime = 10,
  WaitingPenaltyShootout = 11,
  PenaltyShootout = 12,
  FinishedPenaltyShootout = 13,
  Interrupted = 14,
  Abandoned = 15,
  Cancelled = 16,
  TxCoverageCancelled = 17,
  TxCoverageSuspended = 18,
  Postponed = 19,
}

/** Final match outcome marker — statusId=100, period=100. */
export const FINAL_STATUS_ID = 100;

// ── Stat keys (soccer) ──────────────────────────────────────────────
//
// Stats are encoded as period_prefix + base_key.
// Period prefixes: 0=Total, 1000=H1, 2000=HT, 3000=H2, 4000=ET1,
// 5000=ET2, 6000=PE, 7000=ETTotal.

export enum StatKey {
  // Full game (period prefix 0)
  P1Goals = 1,
  P2Goals = 2,
  P1YellowCards = 3,
  P2YellowCards = 4,
  P1RedCards = 5,
  P2RedCards = 6,
  P1Corners = 7,
  P2Corners = 8,
}

/** Build a period-specific stat key from a base key + period prefix. */
export function periodStatKey(baseKey: StatKey, periodPrefix: number): number {
  return periodPrefix + baseKey;
}

// ── Score events ────────────────────────────────────────────────────

export interface ScoreUpdate {
  FixtureId: number;
  Seq: number;
  Ts: number; // timestamp in ms
  StatusId?: number;
  Period?: number;
  GameState?: string | number;
  Action?: string;
  Stats?: Record<string, number>;
  Data?: Record<string, unknown>;
  /** Which participant (1 or 2) the event belongs to. */
  Participant?: number;
  /** Confirmed flag — unconfirmed events may be amended. */
  Confirmed?: boolean;
}

// ── Validation proofs ───────────────────────────────────────────────

export interface ProofNode {
  hash: string | number[] | Uint8Array;
  isRightSibling: boolean;
}

export interface StatToProve {
  /** Stat key (API field name: "key"). */
  key: number;
  value: number;
  period?: number;
}

export interface UpdateStats {
  updateCount: number;
  minTimestamp: number;
  maxTimestamp: number;
}

export interface FixtureSummary {
  fixtureId: number;
  updateStats: UpdateStats;
  eventStatsSubTreeRoot: string;
}

export interface StatValidationResponse {
  summary: FixtureSummary;
  subTreeProof: ProofNode[];
  mainTreeProof: ProofNode[];
  eventStatRoot: string;
  statToProve: StatToProve;
  statToProve2?: StatToProve;
  statProof: ProofNode[];
  statProof2?: ProofNode[];
  // V2 fields
  statsToProve?: StatToProve[];
  statProofs?: ProofNode[][];
}

// ── Credentials ─────────────────────────────────────────────────────

export interface TxLineCredentials {
  jwt: string;
  apiToken: string;
}

// ── Normalized events (internal to Stoppage) ────────────────────────
//
// These are the events the agent reacts to. They are derived from
// raw TxLINE score updates and represent the domain-level facts that
// drive market creation and settlement.

export type NormalizedEvent =
  | { type: "match_started"; fixtureId: number; matchId: string; homeTeam: string; awayTeam: string; ts: number }
  | { type: "goal_scored"; fixtureId: number; matchId: string; team: string; ts: number; seq: number }
  | { type: "corner_awarded"; fixtureId: number; matchId: string; team: string; ts: number; seq: number }
  | { type: "card_shown"; fixtureId: number; matchId: string; team: string; cardType: "yellow" | "red"; ts: number; seq: number }
  | { type: "match_ended"; fixtureId: number; matchId: string; finalScore: { home: number; away: number }; finalStats: Record<string, number>; ts: number; seq: number }
  | { type: "halftime"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "second_half_started"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "extra_time_started"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "penalty_shootout_started"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "match_interrupted"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "match_resumed"; fixtureId: number; matchId: string; ts: number; seq: number }
  | { type: "shot_taken"; fixtureId: number; matchId: string; team: string; outcome?: string; player?: string; ts: number; seq: number }
  | { type: "substitution"; fixtureId: number; matchId: string; team: string; playerOff?: string; playerOn?: string; ts: number; seq: number }
  | { type: "var_review"; fixtureId: number; matchId: string; decision?: string; ts: number; seq: number }
  | { type: "free_kick_awarded"; fixtureId: number; matchId: string; team: string; kickType?: string; ts: number; seq: number }
  | { type: "penalty_awarded"; fixtureId: number; matchId: string; team: string; ts: number; seq: number }
  | { type: "own_goal"; fixtureId: number; matchId: string; team: string; ts: number; seq: number }
  | { type: "raw_action"; fixtureId: number; matchId: string; action: string; team?: string; data?: Record<string, unknown>; ts: number; seq: number }
  | { type: "heartbeat"; ts: number };
