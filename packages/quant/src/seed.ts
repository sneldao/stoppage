/**
 * Seed derivation — shared between the agent and the browser verify loop.
 *
 * The agent and the browser must derive the exact same seed from the live
 * quote so that the "Verify this price" loop can reproduce the fair value.
 * This helper is the single source of truth for that derivation.
 */

import type { PricingSnapshot } from "./types";

export function deriveSeed(
  predicateKind: string,
  snapshot: PricingSnapshot
): string {
  return `${predicateKind}:${snapshot.matchId}:${snapshot.seq}`;
}
