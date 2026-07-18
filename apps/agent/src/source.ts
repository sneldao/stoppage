/**
 * TxLINE event source — feeds normalized events to the agent loop.
 *
 * Two modes:
 *   1. Live: connects to the TxLINE SSE scores stream
 *   2. Replay: replays historical score data for a completed fixture
 *
 * Both modes produce the same NormalizedEvent stream — the agent loop
 * doesn't know which mode it's in.
 */

import {
  streamScores,
  fetchHistoricalScores,
  normalizeScoreUpdate,
  matchIdFromFixture,
  loadCredentials,
  type Network,
  type TxLineCredentials,
  type ScoreUpdate,
  type NormalizedEvent,
  type Fixture,
} from "@stoppage/txline";

export interface EventSource {
  start: (handler: (event: NormalizedEvent) => void) => Promise<void>;
  stop: () => void;
}

/**
 * Create a live event source that streams from TxLINE SSE.
 * Requires a fixture map to resolve fixture IDs to team names.
 */
export function createLiveSource(
  network: Network,
  creds: TxLineCredentials,
  fixtures: Map<number, Fixture>
): EventSource {
  let stopped = false;
  let controller: { stop: () => void } | null = null;

  const prevStats = new Map<number, Record<string, number>>();
  const prevStatusId = new Map<number, number>();

  return {
    async start(handler) {
      controller = await streamScores(
        network,
        creds,
        (update) => {
          const fixture = fixtures.get(update.FixtureId);
          if (!fixture) return;

          const prev = prevStats.get(update.FixtureId) ?? null;
          const prevSid = prevStatusId.get(update.FixtureId) ?? 0;
          const events = normalizeScoreUpdate(update, fixture, prev, prevSid);
          for (const evt of events) handler(evt);
          prevStats.set(update.FixtureId, update.Stats ?? {});
          if (update.StatusId) prevStatusId.set(update.FixtureId, update.StatusId);
        },
        (err) => console.error("[live] SSE error:", err.message)
      );
    },
    stop() {
      stopped = true;
      controller?.stop();
    },
  };
}

/**
 * Create a replay event source that replays historical score data.
 * Events are emitted with a configurable delay to simulate real-time.
 */
export function createReplaySource(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number,
  fixture: Fixture,
  replaySpeed = 1 // 1 = real-time, 10 = 10x speed
): EventSource {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    async start(handler) {
      console.log(`[replay] Fetching historical scores for fixture ${fixtureId}...`);
      const scores = await fetchHistoricalScores(network, creds, fixtureId);
      console.log(`[replay] Got ${scores.length} score updates`);

      const prevStats = new Map<number, Record<string, number>>();
      const prevStatusId = new Map<number, number>();
      let lastTs: number | null = null;

      // Process updates sequentially with simulated timing
      let i = 0;
      function processNext() {
        if (stopped || i >= scores.length) {
          if (i >= scores.length) console.log(`[replay] Finished processing ${scores.length} updates`);
          return;
        }

        const update = scores[i];
        const prev = prevStats.get(fixtureId) ?? null;
        const prevSid = prevStatusId.get(fixtureId) ?? 0;
        const events = normalizeScoreUpdate(update, fixture, prev, prevSid);
        prevStats.set(fixtureId, update.Stats ?? {});
        if (update.StatusId) prevStatusId.set(fixtureId, update.StatusId);

        if (i < 5 || i % 100 === 0 || events.length > 0) {
          console.log(`[replay] seq ${i}/${scores.length}: action=${update.Action} statusId=${update.StatusId} → ${events.length} events`);
        }

        // Calculate delay based on real timestamps
        let delay = 0;
        if (lastTs !== null && update.Ts > lastTs) {
          delay = Math.min((update.Ts - lastTs) / replaySpeed, 500); // cap at 500ms
        }
        delay = Math.max(delay, 5); // minimum 5ms

        timer = setTimeout(() => {
          for (const evt of events) handler(evt);
          lastTs = update.Ts;
          i++;
          processNext();
        }, delay);
      }

      processNext();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
