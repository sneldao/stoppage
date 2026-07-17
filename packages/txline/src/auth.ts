/**
 * TxLINE authentication — guest JWT acquisition and API token activation.
 *
 * Flow:
 *   1. POST /auth/guest/start → guest JWT
 *   2. (one-time) On-chain subscribe transaction → txSig
 *   3. POST /api/token/activate with wallet signature → API token
 *   4. Use JWT + API token for all data requests
 *
 * The subscribe transaction (step 2) is in scripts/subscribe-txline.ts
 * because it's a one-time bootstrap that requires Anchor + spl-token.
 * This module handles the recurring auth concerns.
 */

import type { Network, TxLineCredentials } from "./types";
import { getGuestAuthUrl, getActivateUrl } from "./config";

/**
 * Fetch a guest JWT from the TxLINE API.
 * No authentication required — this is the entry point.
 */
export async function fetchGuestJwt(network: Network): Promise<string> {
  const url = getGuestAuthUrl(network);
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) {
    throw new Error(`Guest auth failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.token;
}

/**
 * Sign the activation message and activate the API token.
 *
 * The message format is: `${txSig}:${leagues.join(",")}:${jwt}`
 * For the standard free bundle (no custom leagues), this is:
 *   `${txSig}::${jwt}`
 *
 * @param signMessage - Wallet's signMessage function (returns detached signature)
 */
export async function activateApiToken(
  network: Network,
  txSig: string,
  leagues: number[],
  jwt: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const messageString = `${txSig}:${leagues.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = await signMessage(message);
  const walletSignature = b64Encode(signatureBytes);

  const resp = await fetch(getActivateUrl(network), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      txSig,
      walletSignature,
      leagues,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Activation failed: ${resp.status} ${await resp.text()}`);
  }

  // The activation endpoint may return either JSON ({ token: "..." })
  // or a raw token string. Handle both.
  const text = await resp.text();
  try {
    const data = JSON.parse(text);
    return data.token || data;
  } catch {
    // Not JSON — the raw text IS the token
    return text;
  }
}

/**
 * Full credential acquisition for an already-subscribed wallet.
 *
 * Call this after the on-chain subscribe transaction has confirmed.
 * Returns both the JWT (short-lived, renew on 401) and the API token
 * (persistent across JWT renewals).
 */
export async function getCredentials(
  network: Network,
  txSig: string,
  leagues: number[],
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<TxLineCredentials> {
  const jwt = await fetchGuestJwt(network);
  const apiToken = await activateApiToken(network, txSig, leagues, jwt, signMessage);
  return { jwt, apiToken };
}

/**
 * Renew the guest JWT only (keep the existing API token).
 * Call this when a data request returns 401.
 */
export async function renewJwt(network: Network, apiToken: string): Promise<TxLineCredentials> {
  const jwt = await fetchGuestJwt(network);
  return { jwt, apiToken };
}

// ── Helpers ─────────────────────────────────────────────────────────

function b64Encode(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser path
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
