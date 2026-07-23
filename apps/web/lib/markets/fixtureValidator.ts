/**
 * Fixture validator for betting operations.
 *
 * Pure function that checks whether a market has valid fixture data
 * before allowing bets. This is the transaction-layer gate that prevents
 * users from staking SOL on conditions they can't verify.
 */

import { PublicKey } from "@solana/web3.js";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { isFixtureScheduled, fixtureStartTimeMs } from "@/lib/match/fixtures";
import type { Market } from "@stoppage/sdk";

export interface FixtureValidationResult {
  canBet: boolean;
  reason?: string;
}

/**
 * Find the fixture for a given market address from the store's markets map.
 * Returns null if the market isn't cached (still loading or unknown).
 */
function findFixtureForMarket(
  marketAddr: PublicKey,
  markets: Record<string, Market>,
  fixtures: FixtureWithMatchId[]
): { fixture: FixtureWithMatchId | null; matchId: string | null } {
  const market = markets[marketAddr.toBase58()];
  if (!market) return { fixture: null, matchId: null };

  const matchId = String(market.predicate.matchId);
  const fixture =
    fixtures.find((f) => f.matchId === matchId) ??
    fixtures.find((f) => f.matchId?.toLowerCase() === matchId.toLowerCase()) ??
    null;

  return { fixture, matchId };
}

/**
 * Validate that a market has fixture data available for betting.
 *
 * Reads synchronously from the store: the markets map resolves the
 * market address to a matchId, then the fixtures array is searched
 * for a matching fixture. If the market isn't yet in the store, the
 * validator returns blocked (fail-safe: don't take money blind).
 *
 * Validation rules (matching useBettingGate):
 * - Fixture must exist for the matchId
 * - Match must not have ended (GameState > 4)
 * - If pre-match, kickoff must be within 2 hours
 * - Live matches always pass (feed staleness is a warning, not a block)
 */
export function validateFixtureForBetting(
  markets: Record<string, Market>,
  fixtures: FixtureWithMatchId[],
  marketAddr: PublicKey
): FixtureValidationResult {
  const { fixture, matchId } = findFixtureForMarket(marketAddr, markets, fixtures);

  // Market not yet in store — fail safe, don't let users bet blind
  if (!matchId) {
    return { canBet: false, reason: "Market data still loading" };
  }

  // No fixture for this match — the trust-violation case
  if (!fixture) {
    return { canBet: false, reason: "Awaiting match data" };
  }

  // Match ended
  if (fixture.GameState > 4) {
    return { canBet: false, reason: "Match ended" };
  }

  // Pre-match: block if kickoff > 2h away
  if (isFixtureScheduled(fixture)) {
    const startTime = fixtureStartTimeMs(fixture);
    const hoursUntilKickoff = (startTime - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilKickoff > 2) {
      return { canBet: false, reason: "Betting opens 2h before kickoff" };
    }
  }

  return { canBet: true };
}

/**
 * Async fixture validator for server-side API routes.
 *
 * Fetches market data on-demand and validates against provided fixtures.
 * Used by Blinks API and other server-side endpoints where the store
 * isn't available synchronously.
 *
 * @param fixtures - Array of fixtures to validate against
 * @param marketAddr - Market public key
 * @param fetchMarket - Async function to fetch market data
 */
export async function validateFixtureForBettingAsync(
  fixtures: FixtureWithMatchId[],
  marketAddr: PublicKey,
  fetchMarket: () => Promise<Market | null>
): Promise<FixtureValidationResult> {
  try {
    const market = await fetchMarket();
    if (!market) {
      return { canBet: false, reason: "Market not found" };
    }

    const matchId = String(market.predicate.matchId);
    const fixture =
      fixtures.find((f) => f.matchId === matchId) ??
      fixtures.find((f) => f.matchId?.toLowerCase() === matchId.toLowerCase()) ??
      null;

    // No fixture for this match
    if (!fixture) {
      return { canBet: false, reason: "Awaiting match data" };
    }

    // Match ended
    if (fixture.GameState > 4) {
      return { canBet: false, reason: "Match ended" };
    }

    // Pre-match: block if kickoff > 2h away
    if (isFixtureScheduled(fixture)) {
      const startTime = fixtureStartTimeMs(fixture);
      const hoursUntilKickoff = (startTime - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilKickoff > 2) {
        return { canBet: false, reason: "Betting opens 2h before kickoff" };
      }
    }

    return { canBet: true };
  } catch (e) {
    return { canBet: false, reason: "Failed to validate fixture" };
  }
}
