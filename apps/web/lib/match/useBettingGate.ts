import { useMemo } from "react";
import { useFixtures, useFixtureScore } from "./useFixtures";
import { isFixtureLive, isFixtureScheduled, fixtureStartTimeMs } from "./fixtures";
import { snapshotIsFresh } from "./types";
import type { Market } from "@stoppage/sdk";

/** Betting gate states driven by fixture + feed availability */
export type BettingGate =
  | "awaiting_fixture" // No fixture data found
  | "match_ended" // Fixture exists but match is over
  | "pre_match_too_early" // Match exists but kickoff is >2h away
  | "pre_match_ready" // Match exists, kickoff within 2h, betting open
  | "live_feed_current" // Match live, feed fresh
  | "live_feed_delayed"; // Match live, feed stale

export interface BettingGateState {
  gate: BettingGate;
  canBet: boolean;
  reason?: string;
}

/**
 * Determines whether betting should be allowed based on fixture availability
 * and match state. Blocks betting when:
 * - No fixture data available (can't verify what we're betting on)
 * - Match has ended
 * - Kickoff is >2h away (too early to bet)
 */
export function useBettingGate(matchId: string | number): BettingGateState {
  const { fixtures, fixturesLoading } = useFixtures();
  
  const fixture = useMemo(() => {
    const id = String(matchId);
    const exact = fixtures.find((f) => f.matchId === id);
    if (exact) return exact;
    const byFixtureId = fixtures.find((f) => String(f.FixtureId) === id);
    if (byFixtureId) return byFixtureId;
    // Fixture-scoped matchIds end with `-<FixtureId>` — prefer suffix match
    // before fuzzy includes() so two fixtures can't cross-match.
    const bySuffix = fixtures.find((f) => f.matchId?.endsWith(`-${id}`) || id.endsWith(`-${f.FixtureId}`));
    if (bySuffix) return bySuffix;
    const lower = id.toLowerCase();
    return fixtures.find((f) =>
      f.matchId?.toLowerCase() === lower ||
      f.matchId?.toLowerCase().includes(lower) ||
      lower.includes(f.matchId?.toLowerCase() ?? "")
    ) ?? null;
  }, [fixtures, matchId]);

  const live = isFixtureLive(fixture);
  
  // Get score snapshot for live matches only
  const snapshot = useFixtureScore(live && fixture ? fixture.FixtureId : null);
  const fresh = snapshotIsFresh(snapshot);

  const gate: BettingGate = useMemo(() => {
    if (fixturesLoading) return "awaiting_fixture";
    if (!fixture) return "awaiting_fixture";
    
    // Match ended (GameState > 4 typically means finished)
    if (fixture.GameState > 4) return "match_ended";
    
    if (live) {
      return fresh ? "live_feed_current" : "live_feed_delayed";
    }
    
    // Pre-match: check if kickoff is within 2 hours
    if (isFixtureScheduled(fixture)) {
      const startTime = fixtureStartTimeMs(fixture);
      const hoursUntilKickoff = (startTime - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilKickoff > 2) return "pre_match_too_early";
      return "pre_match_ready";
    }
    
    // Default to awaiting if state is unclear
    return "awaiting_fixture";
  }, [fixture, fixturesLoading, live, fresh]);

  const canBet = gate === "pre_match_ready" || gate === "live_feed_current" || gate === "live_feed_delayed";
  
  const reason = !canBet ? (() => {
    switch (gate) {
      case "awaiting_fixture": return "Awaiting match data";
      case "match_ended": return "Match ended";
      case "pre_match_too_early": return "Betting opens 2h before kickoff";
      default: return undefined;
    }
  })() : undefined;

  return { gate, canBet, reason };
}

/**
 * Combined market + fixture betting state. Use this anywhere you need to
 * determine whether a market can accept bets. Combines market.status with
 * the fixture betting gate so UI surfaces stay consistent.
 */
export interface MarketBettingState extends BettingGateState {
  canBet: boolean;
  reason?: string;
  marketStatus: Market["status"];
}

/**
 * True when a market resolves via a TxLINE fixture and therefore needs
 * the betting gate (data availability, match state, 2h pre-match window).
 * Price markets resolve against a price feed and tsdb-linked markets
 * resolve from the operator's attested observation — neither has a
 * TxLINE fixture to gate on, so they are bettable whenever open. (Rule 6:
 * this is the single source for that exemption; the markets tape reuses it.)
 */
export function isFixtureGatedMarket(market: Market): boolean {
  return (
    market.predicate.kind !== "price_above" &&
    !market.predicate.matchId.startsWith("tsdb:")
  );
}

export function useMarketBettingState(market: Market | null): MarketBettingState {
  const fixtureGate = useBettingGate(market?.predicate.matchId ?? "");

  if (!market) {
    return {
      ...fixtureGate,
      marketStatus: "open" as const,
      canBet: false,
      reason: "Market not found",
    };
  }

  // Market must be open AND (for fixture-resolved markets) the fixture
  // gate must allow betting.
  const canBet = market.status === "open" && (!isFixtureGatedMarket(market) || fixtureGate.canBet);
  
  const reason = !canBet ? (() => {
    if (market.status !== "open") {
      switch (market.status) {
        case "awaiting_settlement": return "Market settling";
        case "settled": return "Market resolved";
        case "void": return "Market voided";
        default: return "Market closed";
      }
    }
    return fixtureGate.reason;
  })() : undefined;

  return {
    ...fixtureGate,
    canBet,
    reason,
    marketStatus: market.status,
  };
}
