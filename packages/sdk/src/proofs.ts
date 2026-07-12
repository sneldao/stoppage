/**
 * Verifiable Resolution — fetch and independently verify the TxLINE
 * Merkle proof used to settle a market. This is the "proof is the product"
 * differentiator: users shouldn't need to trust Stoppage's UI, just the
 * anchored root + proof.
 */

import type { SettlementProof } from "./types";

/**
 * Fetch the raw settlement proof for a market from TxLINE's
 * scores-validation primitive.
 * TODO: call TxLINE's documented endpoint (see quickstart docs) once a
 * market has reached "awaiting_settlement".
 */
export async function fetchSettlementProof(_marketId: string): Promise<SettlementProof> {
  throw new Error("TODO: fetch proof from TxLINE validation primitive");
}

/**
 * Client-side re-verification of a Merkle proof against the anchored root,
 * independent of whatever the settlement program already checked on-chain.
 * This is what "verifiable" actually means here — don't just display the
 * proof, let a curious user (or judge) confirm it.
 * TODO: implement Merkle path verification against anchoredRoot.
 */
export function verifyProofLocally(_proof: SettlementProof): boolean {
  throw new Error("TODO: implement local Merkle verification");
}
