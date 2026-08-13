/**
 * TxLINE fixtures API — snapshot of upcoming and current fixtures.
 */

import type { Network, TxLineCredentials, Fixture } from "./types";
import { GamePhase } from "./types";
import { getApiBase } from "./config";
import { fetchHistoricalScores } from "./scores";

function authHeaders(creds: TxLineCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.jwt}`,
    "X-Api-Token": creds.apiToken,
  };
}

const REPLAYABLE_PHASES = new Set<GamePhase>([
  GamePhase.Finished,
  GamePhase.FinishedExtraTime,
  GamePhase.FinishedPenaltyShootout,
]);

/** Short TTL cache — historical score probes are expensive on cold loads. */
const REPLAY_CACHE_TTL_MS = 5 * 60 * 1000;
const replayHistoryCache = new Map<number, { replayable: boolean; checkedAt: number }>();

/** Default cap for historical probes on a cold fixtures payload. */
export const DEFAULT_REPLAY_PROBE_LIMIT = 12;

function fixtureStartMs(fixture: Pick<Fixture, "StartTime">): number {
  const raw = fixture.StartTime;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/** Terminal match phases that may have historical score data for replay. */
export function isFixtureFinished(fixture: Pick<Fixture, "GameState">): boolean {
  return REPLAYABLE_PHASES.has(fixture.GameState as GamePhase);
}

/** Whether TxLINE returned at least one historical score update for this fixture. */
export async function fixtureHasReplayHistory(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number
): Promise<boolean> {
  const now = Date.now();
  const cached = replayHistoryCache.get(fixtureId);
  if (cached && now - cached.checkedAt < REPLAY_CACHE_TTL_MS) {
    return cached.replayable;
  }

  let replayable = false;
  try {
    const scores = await fetchHistoricalScores(network, creds, fixtureId);
    replayable = scores.length > 0;
  } catch {
    replayable = false;
  }

  replayHistoryCache.set(fixtureId, { replayable, checkedAt: now });
  return replayable;
}

export type FixtureWithReplayable = Fixture & { replayable: boolean };

export interface AttachReplayableOptions {
  /** Max finished fixtures to probe for historical scores (default 12). */
  maxProbes?: number;
}

/** Attach replayable flags — probes history only for finished fixtures. */
export async function attachReplayableFlags(
  network: Network,
  creds: TxLineCredentials,
  fixtures: Fixture[],
  options: AttachReplayableOptions = {}
): Promise<FixtureWithReplayable[]> {
  const maxProbes = options.maxProbes ?? DEFAULT_REPLAY_PROBE_LIMIT;
  const finished = fixtures
    .filter(isFixtureFinished)
    .sort((a, b) => fixtureStartMs(b) - fixtureStartMs(a));
  const probeIds = new Set(finished.slice(0, maxProbes).map((f) => f.FixtureId));

  return Promise.all(
    fixtures.map(async (fixture) => {
      if (!isFixtureFinished(fixture) || !probeIds.has(fixture.FixtureId)) {
        return { ...fixture, replayable: false };
      }
      const replayable = await fixtureHasReplayHistory(network, creds, fixture.FixtureId);
      return { ...fixture, replayable };
    })
  );
}

/**
 * Fetch all fixtures, optionally filtered by competition ID.
 */
export async function fetchFixtures(
  network: Network,
  creds: TxLineCredentials,
  competitionId?: number
): Promise<Fixture[]> {
  const url = new URL(`${getApiBase(network)}/fixtures/snapshot`);
  if (competitionId !== undefined) {
    url.searchParams.set("competitionId", String(competitionId));
  }
  const resp = await fetch(url.toString(), {
    headers: { ...authHeaders(creds), "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Fixtures snapshot failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as Fixture[];
}

/**
 * One snapshot fetch, then client-side filter to the given competition IDs.
 * Prefer this over N server-side filtered calls when selecting a bundle.
 */
export async function fetchFixturesForCompetitions(
  network: Network,
  creds: TxLineCredentials,
  competitionIds: readonly number[]
): Promise<Fixture[]> {
  const all = await fetchFixtures(network, creds);
  if (competitionIds.length === 0) return all;
  const allowed = new Set(competitionIds);
  return all.filter(
    (f) => f.CompetitionId !== undefined && allowed.has(f.CompetitionId)
  );
}

/**
 * Fetch a single fixture by ID.
 * Convenience wrapper around fetchFixtures with client-side filtering.
 */
export async function fetchFixture(
  network: Network,
  creds: TxLineCredentials,
  fixtureId: number
): Promise<Fixture | null> {
  const all = await fetchFixtures(network, creds);
  return all.find((f) => f.FixtureId === fixtureId) ?? null;
}
