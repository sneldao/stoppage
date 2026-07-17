/**
 * Verifiable Resolution — fetch and independently verify the TxLINE
 * Merkle proof used to settle a market. This is the "proof is the product"
 * differentiator: users shouldn't need to trust Stoppage's UI, just the
 * anchored root + proof.
 *
 * The verification is a standard Merkle path walk:
 *   1. Start with the leaf hash (SHA-256 of the serialized stat)
 *   2. For each proof node, combine with the sibling hash
 *      (left or right based on isRightSibling)
 *   3. Compare the final hash to the anchored root
 *
 * TxLINE uses SHA-256 for its Merkle trees (standard for Solana).
 */

import { sha256 } from "js-sha256";
import type { SettlementProof } from "./types";

/**
 * Verify a Merkle proof path against an anchored root.
 *
 * Walks the proof path from leaf to root, combining each node's hash
 * with the current hash (left or right based on isRightSibling), and
 * checks that the final hash equals the expected root.
 *
 * @param leafHash - 32-byte hash of the leaf data
 * @param proof - Merkle proof path (array of { hash, isRightSibling })
 * @param expectedRoot - 32-byte root hash to compare against
 * @returns true if the proof is valid
 */
export function verifyMerklePath(
  leafHash: Uint8Array,
  proof: Array<{ hash: Uint8Array; isRightSibling: boolean }>,
  expectedRoot: Uint8Array
): boolean {
  let current = leafHash;

  for (const node of proof) {
    const combined = new Uint8Array(current.length + node.hash.length);
    if (node.isRightSibling) {
      // Sibling is on the right: H(current || sibling)
      combined.set(current, 0);
      combined.set(node.hash, current.length);
    } else {
      // Sibling is on the left: H(sibling || current)
      combined.set(node.hash, 0);
      combined.set(current, node.hash.length);
    }
    current = new Uint8Array(sha256.arrayBuffer(combined));
  }

  // Compare
  if (current.length !== expectedRoot.length) return false;
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== expectedRoot[i]) return false;
  }
  return true;
}

/**
 * Hash a stat leaf the way TxLINE does it.
 *
 * TxLINE's ScoreStat struct: { key: u32, value: i32, period: i32 }
 * Serialized as little-endian: 4 bytes key + 4 bytes value + 4 bytes period = 12 bytes
 * Leaf = SHA-256(serialized_stat)
 */
export function hashStatLeaf(
  statKey: number,
  statValue: number,
  period: number = 0
): Uint8Array {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setUint32(0, statKey, true); // little-endian u32
  view.setInt32(4, statValue, true); // little-endian i32
  view.setInt32(8, period, true); // little-endian i32
  const hash = sha256.array(new Uint8Array(buf));
  return new Uint8Array(hash);
}

/**
 * Client-side re-verification of a TxLINE Merkle proof against the
 * anchored root, independent of whatever the settlement program checked
 * on-chain. This is what "verifiable" actually means — don't just
 * display the proof, let a curious user (or judge) confirm it.
 *
 * Verifies three layers:
 *   1. Stat proof: leaf (stat) → event stat root
 *   2. Subtree proof: fixture subtree root → main tree node
 *   3. Main tree proof: main tree node → daily anchored root
 *
 * @returns true if all three layers verify
 */
export function verifyProofLocally(proof: SettlementProof): boolean {
  // Layer 1: Verify the stat proof (leaf → event stat root)
  const leafHash = hashStatLeaf(proof.statKey, proof.statValue);
  const eventStatRoot = hexToBytes(proof.eventStatRoot);
  if (!verifyMerklePath(leafHash, proof.statProof, eventStatRoot)) {
    return false;
  }

  // Layer 2: Verify the subtree proof (event stat root → subtree root)
  // The subtree proof connects the event stat root to the fixture subtree root
  const subTreeRoot = hexToBytes(proof.subTreeRoot);
  if (!verifyMerklePath(eventStatRoot, proof.subTreeProof, subTreeRoot)) {
    return false;
  }

  // Layer 3: Verify the main tree proof (subtree root → daily anchored root)
  const anchoredRoot = hexToBytes(proof.anchoredRoot);
  if (!verifyMerklePath(subTreeRoot, proof.mainTreeProof, anchoredRoot)) {
    return false;
  }

  return true;
}

/**
 * Verify just the stat layer (the most important one — proves the
 * stat value is in the tree). Useful for quick checks without the
 * full three-layer verification.
 */
export function verifyStatProof(
  statKey: number,
  statValue: number,
  statProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>,
  eventStatRoot: string
): boolean {
  const leafHash = hashStatLeaf(statKey, statValue);
  const root = hexToBytes(eventStatRoot);
  return verifyMerklePath(leafHash, statProof, root);
}

/**
 * Build a SettlementProof from raw TxLINE validation response fields.
 *
 * This keeps the SDK independent of @stoppage/txline — the caller
 * (agent or web API route) fetches the proof from TxLINE, then passes
 * the raw fields here to construct a verifiable SettlementProof.
 */
export function buildSettlementProof(params: {
  marketId: string;
  matchId: string;
  fixtureId: number;
  seq: number;
  timestamp: number;
  statKey: number;
  statValue: number;
  outcome: "yes" | "no" | "void";
  statement: string;
  eventStatRoot: string;
  subTreeRoot: string;
  anchoredRoot: string;
  statProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
  subTreeProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
  mainTreeProof: Array<{ hash: Uint8Array; isRightSibling: boolean }>;
}): SettlementProof {
  return {
    marketId: params.marketId,
    matchId: params.matchId,
    statement: params.statement,
    anchoredRoot: params.anchoredRoot,
    verifiedAt: new Date().toISOString(),
    outcome: params.outcome,
    fixtureId: params.fixtureId,
    seq: params.seq,
    timestamp: params.timestamp,
    statKey: params.statKey,
    statValue: params.statValue,
    statProof: params.statProof,
    subTreeProof: params.subTreeProof,
    mainTreeProof: params.mainTreeProof,
    eventStatRoot: params.eventStatRoot,
    subTreeRoot: params.subTreeRoot,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function hexToBytes(hex: string | number[]): Uint8Array {
  if (Array.isArray(hex)) {
    return Uint8Array.from(hex);
  }
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}
