/**
 * Snapshot hashing — the reproducibility contract for the onchain attestation.
 *
 * The agent computes hashSnapshot(snapshot) offchain, submits it to the
 * pricing_receipt account, and signs over it. A verifier reconstructs the
 * snapshot from the (TxLINE-anchored) data, hashes it with this same
 * function, and checks it matches the onchain value. The onchain program
 * only stores + compares the hash (it cannot run TS), so the function lives
 * here and is the single source of truth for the snapshot-hash space.
 *
 * Canonical JSON (sorted keys, fixed field order, no whitespace) keeps the
 * hash stable regardless of property-iteration order. SHA-256 is used so
 * the offchain hash matches the onchain verify_pricing instruction exactly.
 */

import { sha256 } from "js-sha256";
import type { PricingSnapshot } from "./types";

/** Build the canonical JSON string that hashSnapshot digests. */
export function canonicalSnapshotJson(s: PricingSnapshot): string {
  return JSON.stringify({
    matchId: s.matchId,
    fixtureId: s.fixtureId,
    minute: s.minute,
    score: { away: s.score.away, home: s.score.home },
    corners: { away: s.corners.away, home: s.corners.home },
    cards: {
      awayRed: s.cards.awayRed,
      awayYellow: s.cards.awayYellow,
      homeRed: s.cards.homeRed,
      homeYellow: s.cards.homeYellow,
    },
    seq: s.seq,
    ts: s.ts,
  });
}

export function hashSnapshot(s: PricingSnapshot): string {
  return sha256(canonicalSnapshotJson(s));
}
