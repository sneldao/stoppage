/**
 * Market strategy — the decision logic that maps TxLINE events to
 * market creation and settlement actions.
 *
 * This is the agent's brain. It is pure: no I/O, no chain calls.
 * Given a normalized event and the current set of open markets, it
 * returns a list of actions (create_market, settle_market, void_market).
 *
 * The agent loop calls this function on every event and executes
 * the returned actions via the SDK.
 */

import type { NormalizedEvent } from "@stoppage/txline";
import { PREDICATE_KIND, type MarketPredicate } from "@stoppage/sdk";

// ── Actions ─────────────────────────────────────────────────────────

export type AgentAction =
  | {
      type: "create_market";
      predicate: MarketPredicate;
      closesInSeconds: number;
      label: string;
    }
  | {
      type: "settle_market";
      predicate: MarketPredicate;
      outcome: "yes" | "no";
      seq: number;
      statKey: number;
      label: string;
    }
  | {
      type: "void_market";
      predicate: MarketPredicate;
      label: string;
    };

// ── Strategy config ─────────────────────────────────────────────────

// ── Strategy ────────────────────────────────────────────────────────

/**
 * Given a normalized event and the current open markets, decide what
 * actions to take.
 *
 * @param event - The normalized TxLINE event
 * @param openMarkets - Currently open markets (predicates + metadata)
 * @returns Actions to execute
 */
export function decideActions(
  event: NormalizedEvent,
  openMarkets: OpenMarket[]
): AgentAction[] {
  const actions: AgentAction[] = [];

  switch (event.type) {
    case "match_started":
      // Create initial markets for the match
      actions.push(
        createTotalGoalsMarket(event.matchId, event.ts, 3),
        createCornersMarket(event.matchId, event.ts, 9)
      );
      break;

    case "goal_scored":
    case "halftime":
    case "second_half_started":
      // These events do not have a settlement mapping to a TxLINE stat proof.
      break;

    case "match_ended":
      // Settle all remaining markets for this match
      for (const m of openMarkets) {
        if (m.predicate.matchId !== event.matchId) continue;

        if (m.predicate.kind === "total_goals_over") {
          // Settle based on final score
          const totalGoals = event.finalScore.home + event.finalScore.away;
          const threshold = Number(m.predicate.params.threshold ?? 0);
          actions.push({
            type: "settle_market",
            predicate: m.predicate,
            outcome: totalGoals > threshold ? "yes" : "no",
            seq: event.seq,
            statKey: 1, // P1 goals — will fetch both P1+P2 for validation
            label: m.label,
          });
        } else if (m.predicate.kind === "corners_over") {
          // Settle based on final corner count from finalStats
          const p1Corners = event.finalStats[String(7)] ?? 0; // StatKey.P1Corners
          const p2Corners = event.finalStats[String(8)] ?? 0; // StatKey.P2Corners
          const totalCorners = p1Corners + p2Corners;
          const threshold = Number(m.predicate.params.threshold ?? 0);
          actions.push({
            type: "settle_market",
            predicate: m.predicate,
            outcome: totalCorners > threshold ? "yes" : "no",
            seq: event.seq,
            statKey: 7,
            label: m.label,
          });
        }
      }
      break;

    // corner_awarded, card_shown — no immediate market actions
    // (these feed into the over/under markets which settle at match end)
  }

  return actions;
}

// ── Open market tracking ────────────────────────────────────────────

export interface OpenMarket {
  predicate: MarketPredicate;
  label: string;
  createdAt: number;
  ttlSeconds: number;
  marketPda?: string; // Set after on-chain creation
}

// ── Market creation helpers ─────────────────────────────────────────

function createTotalGoalsMarket(matchId: string, ts: number, threshold: number): AgentAction {
  const predicate: MarketPredicate = {
    kind: "total_goals_over",
    matchId,
    params: { team: "", threshold },
  };
  return {
    type: "create_market",
    predicate,
    closesInSeconds: 7200, // Closes at match end
    label: `Total goals over ${threshold} — ${matchId}`,
  };
}

function createCornersMarket(matchId: string, ts: number, threshold: number): AgentAction {
  const predicate: MarketPredicate = {
    kind: "corners_over",
    matchId,
    params: { team: "", threshold },
  };
  return {
    type: "create_market",
    predicate,
    closesInSeconds: 7200,
    label: `Total corners over ${threshold} — ${matchId}`,
  };
}
