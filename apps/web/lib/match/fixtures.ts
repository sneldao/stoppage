import type { FixtureWithMatchId } from "@/lib/match/types";

// GamePhase.FirstHalf / GamePhase.SecondHalf (@stoppage/txline). Kept as
// literals here because a value import of the enum pulls txline's node-only
// credentials module (fs) into the client bundle.
const FIRST_HALF = 2;
const SECOND_HALF = 4;
const NOT_STARTED = 1;

/**
 * A fixture is in play during the first or second half.
 * Single source of truth for "is this match live" across the web app.
 */
export function isFixtureLive(fixture: Pick<FixtureWithMatchId, "GameState"> | null | undefined): boolean {
  return fixture?.GameState === FIRST_HALF || fixture?.GameState === SECOND_HALF;
}

export function isFixtureScheduled(fixture: Pick<FixtureWithMatchId, "GameState"> | null | undefined): boolean {
  return fixture?.GameState === NOT_STARTED;
}

export function fixtureStartTimeMs(fixture: Pick<FixtureWithMatchId, "StartTime">): number {
  const raw = fixture.StartTime as unknown;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") return new Date(raw).getTime();
  return 0;
}

/**
 * Fixtures the agent can replay — uses the server-computed `replayable` flag
 * from GET /api/fixtures (finished phase + TxLINE historical scores).
 */
export function listReplayableFixtures(
  fixtures: FixtureWithMatchId[],
  blockedIds: ReadonlySet<number> = new Set(),
  preferTeams: string[] = []
): FixtureWithMatchId[] {
  const replayable = fixtures
    .filter((f) => f.replayable && !blockedIds.has(f.FixtureId))
    .sort((a, b) => fixtureStartTimeMs(b) - fixtureStartTimeMs(a));

  if (preferTeams.length === 0) return replayable;

  const lowered = preferTeams.map((t) => t.toLowerCase());
  const featured: FixtureWithMatchId[] = [];
  const rest: FixtureWithMatchId[] = [];
  for (const f of replayable) {
    const home = (f.Participant1 ?? "").toLowerCase();
    const away = (f.Participant2 ?? "").toLowerCase();
    if (lowered.some((t) => home.includes(t) || away.includes(t))) featured.push(f);
    else rest.push(f);
  }
  return [...featured, ...rest];
}
