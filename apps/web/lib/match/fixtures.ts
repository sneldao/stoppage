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

/**
 * Resolve the fixture for a market's matchId — exact matchId first, then
 * bare fixtureId, then substring fallback. Single source of truth so the
 * market page and match context agree on which fixture a market binds to.
 */
export function fixtureForMatchId(
  fixtures: FixtureWithMatchId[],
  matchId: string | number
): FixtureWithMatchId | null {
  const id = String(matchId);
  const exact = fixtures.find((f) => f.matchId === id);
  if (exact) return exact;
  const byFixtureId = fixtures.find((f) => String(f.FixtureId) === id);
  if (byFixtureId) return byFixtureId;
  const lower = id.toLowerCase();
  return (
    fixtures.find(
      (f) =>
        f.matchId?.toLowerCase() === lower ||
        f.matchId?.toLowerCase().includes(lower) ||
        lower.includes(f.matchId?.toLowerCase() ?? "")
    ) ?? null
  );
}

/**
 * Scoring vocabulary for a fixture's competition. TxLINE US football
 * (comp 500001) records carry points, not goals — labels and market
 * questions read "points" so an NFL market doesn't render as soccer.
 * Literal here for the same bundle reason as the GamePhase constants.
 */
const NFL_COMPETITION_ID = 500001;

export function scoreUnitForFixture(
  fixture: Pick<FixtureWithMatchId, "CompetitionId"> | null | undefined
): "goals" | "points" {
  return fixture?.CompetitionId === NFL_COMPETITION_ID ? "points" : "goals";
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
