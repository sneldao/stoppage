/**
 * Event normalizer — converts raw TxLINE score updates into the
 * domain events the Stoppage agent reacts to.
 *
 * Uses two signals:
 *   1. The `Action` field (e.g., "goal", "corner", "yellow_card") to
 *      detect WHAT happened.
 *   2. The `Participant` field (1 or 2) to determine WHICH team.
 *   3. The `StatusId` field for game phase transitions.
 *
 * Stat diffs are used as a fallback when `Participant` is not present.
 */

import type { ScoreUpdate, NormalizedEvent, Fixture } from "./types";
import { GamePhase, FINAL_STATUS_ID, StatKey } from "./types";

/**
 * Build a human-readable match ID from a fixture (e.g., "FRA-SPA").
 */
export function matchIdFromFixture(fixture: Fixture): string {
  const code = (name: string) => {
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return last.length >= 3 ? last.slice(0, 3).toUpperCase() : last.toUpperCase();
  };
  return `${code(fixture.Participant1)}-${code(fixture.Participant2)}`;
}

/**
 * Resolve the team name from a Participant field (1 or 2).
 */
function teamFromParticipant(participant: number, fixture: Fixture): string {
  return participant === 1 ? fixture.Participant1 : fixture.Participant2;
}

/**
 * Resolve the team name from a stat key (odd = P1, even = P2).
 */
function teamFromStatKey(statKey: number, fixture: Fixture): string {
  const baseKey = statKey % 1000;
  const isP1 = baseKey % 2 === 1;
  return isP1 ? fixture.Participant1 : fixture.Participant2;
}

/**
 * Normalize a raw score update into domain events.
 *
 * @param update - Raw TxLINE score update
 * @param fixture - The fixture this update belongs to
 * @param prevStats - Previous stats snapshot (for diffing). Null on first update.
 * @param matchStarted - Whether match_started has already been emitted for this fixture.
 * @param secondHalfStarted - Whether second_half_started has already been emitted.
 * @param halftimeEmitted - Whether halftime has already been emitted.
 */
export function normalizeScoreUpdate(
  update: ScoreUpdate,
  fixture: Fixture,
  prevStats: Record<string, number> | null,
  matchStarted = false,
  secondHalfStarted = false,
  halftimeEmitted = false
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const matchId = matchIdFromFixture(fixture);
  const action = update.Action ?? "";
  const statusId = update.StatusId ?? 0;
  const stats = update.Stats ?? {};

  // ── Match finalised ──────────────────────────────────────────────
  if (action === "game_finalised" || statusId === FINAL_STATUS_ID) {
    const p1Goals = stats[String(StatKey.P1Goals)] ?? 0;
    const p2Goals = stats[String(StatKey.P2Goals)] ?? 0;
    events.push({
      type: "match_ended",
      fixtureId: fixture.FixtureId,
      matchId,
      finalScore: { home: p1Goals, away: p2Goals },
      finalStats: stats,
      ts: update.Ts,
      seq: update.Seq,
    });
    return events;
  }

  // ── Game phase transitions (StatusId) ────────────────────────────
  if (statusId === GamePhase.FirstHalf && !matchStarted) {
    events.push({
      type: "match_started",
      fixtureId: fixture.FixtureId,
      matchId,
      homeTeam: fixture.Participant1,
      awayTeam: fixture.Participant2,
      ts: update.Ts,
    });
  }

  if (statusId === GamePhase.Halftime && !halftimeEmitted) {
    events.push({
      type: "halftime",
      fixtureId: fixture.FixtureId,
      matchId,
      ts: update.Ts,
      seq: update.Seq,
    });
  } else if (statusId === GamePhase.SecondHalf && !secondHalfStarted) {
    events.push({
      type: "second_half_started",
      fixtureId: fixture.FixtureId,
      matchId,
      ts: update.Ts,
      seq: update.Seq,
    });
  }

  // ── Action-based events ──────────────────────────────────────────
  // Use the Participant field when available, fall back to stat diffs.

  if (action === "goal") {
    const team = update.Participant
      ? teamFromParticipant(update.Participant, fixture)
      : detectTeamFromStatDiff(prevStats, stats, [StatKey.P1Goals, StatKey.P2Goals], fixture);
    if (team) {
      events.push({
        type: "goal_scored",
        fixtureId: fixture.FixtureId,
        matchId,
        team,
        ts: update.Ts,
        seq: update.Seq,
      });
    }
  } else if (action === "corner") {
    const team = update.Participant
      ? teamFromParticipant(update.Participant, fixture)
      : detectTeamFromStatDiff(prevStats, stats, [StatKey.P1Corners, StatKey.P2Corners], fixture);
    if (team) {
      events.push({
        type: "corner_awarded",
        fixtureId: fixture.FixtureId,
        matchId,
        team,
        ts: update.Ts,
        seq: update.Seq,
      });
    }
  } else if (action === "yellow_card") {
    const team = update.Participant
      ? teamFromParticipant(update.Participant, fixture)
      : detectTeamFromStatDiff(prevStats, stats, [StatKey.P1YellowCards, StatKey.P2YellowCards], fixture);
    if (team) {
      events.push({
        type: "card_shown",
        fixtureId: fixture.FixtureId,
        matchId,
        team,
        cardType: "yellow",
        ts: update.Ts,
        seq: update.Seq,
      });
    }
  } else if (action === "red_card" || action === "second_yellow_card") {
    const team = update.Participant
      ? teamFromParticipant(update.Participant, fixture)
      : detectTeamFromStatDiff(prevStats, stats, [StatKey.P1RedCards, StatKey.P2RedCards], fixture);
    if (team) {
      events.push({
        type: "card_shown",
        fixtureId: fixture.FixtureId,
        matchId,
        team,
        cardType: "red",
        ts: update.Ts,
        seq: update.Seq,
      });
    }
  }

  return events;
}

/**
 * Detect which team's stat increased by diffing prev and curr stats.
 * Returns the team name, or null if no relevant increase was found.
 */
function detectTeamFromStatDiff(
  prev: Record<string, number> | null,
  curr: Record<string, number>,
  candidateKeys: StatKey[],
  fixture: Fixture
): string | null {
  if (!prev) return null;

  for (const key of candidateKeys) {
    const prevVal = prev[String(key)] ?? 0;
    const currVal = curr[String(key)] ?? 0;
    if (currVal > prevVal) {
      return teamFromStatKey(key, fixture);
    }
  }
  return null;
}
