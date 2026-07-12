/**
 * Session-key delegation client.
 *
 * This is the piece worth building first and building for real. A session
 * key that's "authorized on-chain" but never signs a transaction is a demo
 * that falls apart on inspection. Every method below is a stub — fill these
 * in before touching UI polish.
 */

import type { SessionKeyGrant } from "./types";

export interface DelegateParams {
  ownerPubkey: string;
  allowedPrograms: string[];
  maxStakeLamportsPerMarket: number;
  ttlSeconds: number;
}

/**
 * Step 1 (wallet popup, once): owner wallet signs a delegation transaction
 * that authorizes a freshly generated session keypair on-chain, scoped by
 * program allowlist, stake cap, and expiry.
 *
 * TODO: build + send the actual delegation transaction. This should be the
 * *only* wallet.signTransaction() call in the entire betting flow.
 */
export async function delegateSessionKey(
  _params: DelegateParams
): Promise<SessionKeyGrant> {
  throw new Error("TODO: implement on-chain delegation transaction");
}

/**
 * Step 2 (no wallet popup, every bet): sign a market-join or claim
 * instruction with the session keypair directly.
 *
 * TODO: this must actually sign with the session key's local keypair, not
 * defer back to the wallet adapter. If this function ever calls
 * wallet.signTransaction(), the differentiator doesn't exist yet.
 */
export async function signWithSessionKey(
  _grant: SessionKeyGrant,
  _instructionData: Uint8Array
): Promise<Uint8Array /* signature */> {
  throw new Error("TODO: implement session-key local signing");
}

/**
 * Revoke a delegation early. Requires the owner wallet (one more popup),
 * which is the correct tradeoff — revocation should not be frictionless.
 */
export async function revokeSessionKey(
  _grant: SessionKeyGrant
): Promise<void> {
  throw new Error("TODO: implement revocation transaction");
}
