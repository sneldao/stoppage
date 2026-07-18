/**
 * Append-only activity contract shared by Matchkeeper and the web surface.
 * Entries are facts observed or emitted by the keeper; they are not market
 * state and do not grant the web process any control over the agent.
 */
export type MatchEventKind =
  | "txline_observed"
  | "market_created"
  | "proof_validated"
  | "settlement_confirmed"
  | "market_voided"
  | "action_failed"
  | "position_submitted";

export interface MatchEvent {
  id: string;
  occurredAt: number;
  kind: MatchEventKind;
  label: string;
  matchId: string;
  fixtureId?: number;
  marketId?: string;
  signature?: string;
  source: "txline" | "matchkeeper" | "solana" | "wallet";
}
