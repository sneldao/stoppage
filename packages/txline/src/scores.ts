/**
 * TxLINE scores API — snapshots, historical, and live streams.
 *
 * All methods require valid credentials (JWT + API token) from auth.ts.
 * Uses native fetch — no external HTTP dependency.
 */

import type { Network, TxLineCredentials, ScoreUpdate } from "./types";
import { getApiBase } from "./config";
import { connectSse, parseSseBlock, parseSseData, type SseController } from "./sse";

function authHeaders(creds: TxLineCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.jwt}`,
    "X-Api-Token": creds.apiToken,
  };
}

/**
 * Fetch a scores snapshot for a specific fixture.
 * Returns the current state of all score records for that fixture.
 *
 * Note: The TxLINE API may return this as SSE or JSON depending on the
 * endpoint. We handle both.
 */
export async function fetchScoresSnapshot(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number
): Promise<ScoreUpdate[]> {
  const url = `${getApiBase(network)}/scores/snapshot/${fixtureId}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(creds), Accept: "application/json, text/event-stream" },
  });
  if (!resp.ok) {
    throw new Error(`Scores snapshot failed: ${resp.status} ${await resp.text()}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return collectSseStream(resp);
  }
  return (await resp.json()) as ScoreUpdate[];
}

/**
 * Fetch historical score updates for a fixture.
 * Only available for fixtures that started between 2 weeks and 6 hours ago.
 *
 * Note: The TxLINE API returns this as an SSE stream, not a JSON array.
 * We read the full stream and collect all messages into an array.
 */
export async function fetchHistoricalScores(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number
): Promise<ScoreUpdate[]> {
  const url = `${getApiBase(network)}/scores/historical/${fixtureId}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(creds), Accept: "text/event-stream" },
  });
  if (!resp.ok) {
    throw new Error(`Historical scores failed: ${resp.status} ${await resp.text()}`);
  }
  return collectSseStream(resp);
}

/**
 * Fetch score updates for a specific time interval.
 * Intervals are 5-minute buckets: epochDay / hourOfDay / interval
 */
export async function fetchScoreUpdates(
  network: Network,
  creds: TxLineCredentials,
  epochDay: number,
  hourOfDay: number,
  interval: number
): Promise<ScoreUpdate[]> {
  const url = `${getApiBase(network)}/scores/updates/${epochDay}/${hourOfDay}/${interval}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(creds), Accept: "application/json, text/event-stream" },
  });
  if (!resp.ok) {
    throw new Error(`Score updates failed: ${resp.status} ${await resp.text()}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return collectSseStream(resp);
  }
  return (await resp.json()) as ScoreUpdate[];
}

/**
 * Connect to the live scores SSE stream.
 *
 * The handler is called for every score event. Heartbeat messages
 * (empty data) are filtered out — only real score updates are passed.
 *
 * Returns a controller to stop the stream.
 */
export async function streamScores(
  network: Network,
  creds: TxLineCredentials,
  handler: (update: ScoreUpdate) => void,
  onError?: (error: Error) => void
): Promise<SseController> {
  const url = `${getApiBase(network)}/scores/stream`;
  return connectSse(
    url,
    authHeaders(creds),
    (message) => {
      const data = parseSseData(message.data);
      // Skip heartbeats (non-JSON or empty)
      if (data && typeof data === "object") {
        handler(data as ScoreUpdate);
      }
    },
    onError
  );
}

// ── Internal ────────────────────────────────────────────────────────

/**
 * Read a complete SSE response body and collect all JSON messages
 * into an array. Used by snapshot/historical endpoints that return
 * SSE instead of JSON.
 */
async function collectSseStream(resp: Response): Promise<ScoreUpdate[]> {
  if (!resp.body) {
    throw new Error("Response has no body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const updates: ScoreUpdate[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator?.index !== undefined) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);

      const message = parseSseBlock(block);
      if (message?.data) {
        const data = parseSseData(message.data);
        if (data && typeof data === "object") {
          updates.push(data as ScoreUpdate);
        }
      }

      separator = buffer.match(/\r?\n\r?\n/);
    }
  }

  // Flush remaining buffer
  buffer += decoder.decode();
  const message = parseSseBlock(buffer);
  if (message?.data) {
    const data = parseSseData(message.data);
    if (data && typeof data === "object") {
      updates.push(data as ScoreUpdate);
    }
  }

  return updates;
}
