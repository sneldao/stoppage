/**
 * Market vault (escrow) client — join, pot, claim.
 * Adapted from a prior transaction-builder escrow flow; the shape carries
 * over almost 1:1 from generic "join a pot / claim on resolution" logic.
 */

import type { Market, MarketPredicate, Position } from "./types";

export interface JoinMarketParams {
  predicate: MarketPredicate;
  side: "yes" | "no";
  amountLamports: number;
  /** Pass a session-key signer here for frictionless in-play betting. */
  signer: "wallet" | "sessionKey";
}

/**
 * Open (or join an existing) market vault for a given predicate + side.
 * TODO: build the vault PDA derivation + join instruction.
 */
export async function joinMarket(_params: JoinMarketParams): Promise<Position> {
  throw new Error("TODO: implement join-market instruction");
}

/**
 * Claim payout after a market has settled. Only valid once a
 * SettlementProof has been verified on-chain via the settlement program.
 * TODO: build the claim instruction, gated on settled market status.
 */
export async function claimPosition(_position: Position): Promise<string /* tx sig */> {
  throw new Error("TODO: implement claim instruction");
}

/**
 * Fetch current market state (status, vault balance, close time).
 * TODO: wire to on-chain account fetch once the market program exists.
 */
export async function getMarket(_marketId: string): Promise<Market> {
  throw new Error("TODO: implement market account fetch");
}
