import type { Fixture } from "@stoppage/txline";

// GamePhase literals from @stoppage/txline — not imported here because the enum
// pulls txline's node-only credentials module (fs) into the client bundle.
const NOT_STARTED = 1;
const FIRST_HALF = 2;
const SECOND_HALF = 4;
const FINISHED = 5;
const FINISHED_EXTRA_TIME = 10;
const FINISHED_PENALTIES = 13;

const REPLAYABLE_STATES = new Set([FINISHED, FINISHED_EXTRA_TIME, FINISHED_PENALTIES]);

/**
 * A fixture is in play during the first or second half.
 * Single source of truth for "is this match live" across the web app.
 */
export function isFixtureLive(fixture: Fixture | null | undefined): boolean {
  return fixture?.GameState === FIRST_HALF || fixture?.GameState === SECOND_HALF;
}

/** Full-time (or equivalent terminal) states only — not "anything not live". */
export function isFixtureFinished(fixture: Fixture | null | undefined): boolean {
  const state = fixture?.GameState;
  return typeof state === "number" && REPLAYABLE_STATES.has(state);
}

export function isFixtureScheduled(fixture: Fixture | null | undefined): boolean {
  return fixture?.GameState === NOT_STARTED;
}

export function fixtureStartTimeMs(fixture: Fixture): number {
  const raw = fixture.StartTime as unknown;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") return new Date(raw).getTime();
  return 0;
}

/** Finished fixtures the agent can replay, newest first, optional team priority. */
export function listReplayableFixtures(
  fixtures: Fixture[],
  blockedIds: ReadonlySet<number> = new Set(),
  preferTeams: string[] = []
): Fixture[] {
  const replayable = fixtures
    .filter((f) => isFixtureFinished(f) && !blockedIds.has(f.FixtureId))
    .sort((a, b) => fixtureStartTimeMs(b) - fixtureStartTimeMs(a));

  if (preferTeams.length === 0) return replayable;

  const lowered = preferTeams.map((t) => t.toLowerCase());
  const featured: Fixture[] = [];
  const rest: Fixture[] = [];
  for (const f of replayable) {
    const home = (f.Participant1 ?? "").toLowerCase();
    const away = (f.Participant2 ?? "").toLowerCase();
    if (lowered.some((t) => home.includes(t) || away.includes(t))) featured.push(f);
    else rest.push(f);
  }
  return [...featured, ...rest];
}
