/**
 * TxLINE validation proof fetcher.
 *
 * Fetches Merkle proofs from the TxLINE API that can be verified
 * on-chain via `validateStat` / `validateStatV2` or off-chain via
 * local Merkle verification.
 *
 * The proof endpoint is:
 *   GET /api/scores/stat-validation?fixtureId=...&seq=...&statKey=...
 *   GET /api/scores/stat-validation?fixtureId=...&seq=...&statKeys=1,2,...
 *
 * The seq value MUST come from a real observed score record — never
 * use seq=0. Score sequences start at 1 and increment per fixture.
 */

import type {
  Network,
  TxLineCredentials,
  StatValidationResponse,
  ProofNode,
} from "./types";
import { getApiBase } from "./config";

function authHeaders(creds: TxLineCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.jwt}`,
    "X-Api-Token": creds.apiToken,
  };
}

/**
 * Fetch a single-stat validation proof.
 *
 * @param fixtureId - TxLINE fixture ID
 * @param seq - Score record sequence (from an observed score update, ≥1)
 * @param statKey - Stat key to validate (e.g., StatKey.P1Goals = 1)
 */
export async function fetchStatValidation(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number,
  seq: number,
  statKey: number,
  statKey2?: number
): Promise<StatValidationResponse> {
  const params = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKey: String(statKey),
  });
  if (statKey2 !== undefined) {
    params.set("statKey2", String(statKey2));
  }

  const url = `${getApiBase(network)}/scores/stat-validation?${params}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(creds), "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Stat validation failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

/**
 * Fetch a V2 multi-stat validation proof.
 *
 * @param fixtureId - TxLINE fixture ID
 * @param seq - Score record sequence (from an observed score update, ≥1)
 * @param statKeys - Array of stat keys to validate (order matters for strategy indexes)
 */
export async function fetchStatValidationV2(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number,
  seq: number,
  statKeys: number[]
): Promise<StatValidationResponse> {
  const params = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKeys: statKeys.join(","),
  });

  const url = `${getApiBase(network)}/scores/stat-validation?${params}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(creds), "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`V2 stat validation failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

// ── Proof helpers ───────────────────────────────────────────────────

/**
 * Convert a proof node's hash to a 32-byte array.
 * Accepts hex string (0x-prefixed), base64 string, or byte array.
 */
export function toBytes32(value: string | number[] | Uint8Array): Uint8Array {
  let bytes: Uint8Array;
  if (Array.isArray(value)) {
    bytes = Uint8Array.from(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else if (value.startsWith("0x")) {
    bytes = hexToBytes(value.slice(2));
  } else {
    bytes = base64ToBytes(value);
  }

  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  }
  return bytes;
}

/**
 * Normalize proof nodes from the API response into a consistent shape.
 */
export function normalizeProof(
  nodes: ProofNode[]
): Array<{ hash: Uint8Array; isRightSibling: boolean }> {
  return nodes.map((node) => ({
    hash: toBytes32(node.hash),
    isRightSibling: node.isRightSibling,
  }));
}

/**
 * Compute the epoch day from a proof timestamp (ms since epoch).
 * Used for deriving the daily_scores_roots PDA.
 */
export function epochDayFromTimestamp(proofTimestampMs: number): number {
  if (!Number.isSafeInteger(proofTimestampMs) || proofTimestampMs < 0) {
    throw new Error("Expected a non-negative proof timestamp in milliseconds");
  }
  const epochDay = Math.floor(proofTimestampMs / 86_400_000);
  if (epochDay > 0xffff) {
    throw new Error("Proof timestamp is outside the u16 epoch-day range");
  }
  return epochDay;
}

// ── Internal helpers ────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // Browser path
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
