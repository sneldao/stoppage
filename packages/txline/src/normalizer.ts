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
 * Build a fixture-scoped match ID (e.g. "CIT-CIN-17615188").
 * The FixtureId suffix prevents PDA collisions when the same pairing
 * recurs in a league season, or when two teams share a 3-letter suffix
 * (e.g. "Toronto FC" / "New York City FC" → both "FC").
 */
export function matchIdFromFixture(fixture: Fixture): string {
  const code = (name: string | undefined) => {
    if (!name?.trim()) return "UNK";
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return last.length >= 3 ? last.slice(0, 3).toUpperCase() : last.toUpperCase();
  };
  return `${code(fixture.Participant1)}-${code(fixture.Participant2)}-${fixture.FixtureId}`;
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
 * @param prevStatusId - Previous StatusId for phase transition detection.
 */
export function normalizeScoreUpdate(
  update: ScoreUpdate,
  fixture: Fixture,
  prevStats: Record<string, number> | null,
  prevStatusId = 0
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const matchId = matchIdFromFixture(fixture);
  const action = update.Action ?? "";
  const statusId = update.StatusId ?? 0;
  const stats = update.Stats ?? {};
  const data = update.Data;
  // US Football records share the same StatusId layout (2 = first in-play
  // period, 100 = finalised) and the same total-score stat keys (1/2), but
  // quarter breaks collide with soccer phase IDs (3/4/5...) — so only
  // match_started and match_ended are meaningful, and score changes are
  // detected by stat diff rather than a "goal" action.
  const isUsFootball = update.Type === "UsFootball";

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
      minute: isUsFootball ? 60 : undefined,
    });
    return events;
  }

  // ── Game phase transitions (StatusId) ────────────────────────────
  if (prevStatusId !== statusId) {
    if (statusId === GamePhase.FirstHalf && prevStatusId < GamePhase.FirstHalf) {
      events.push({
        type: "match_started",
        fixtureId: fixture.FixtureId,
        matchId,
        homeTeam: fixture.Participant1,
        awayTeam: fixture.Participant2,
        competitionId: fixture.CompetitionId,
        ts: update.Ts,
      });
    } else if (isUsFootball) {
      // Quarter breaks (3/5/7) and later quarters (4/6/8/9) reuse soccer
      // phase IDs but aren't halves — suppress them for US football.
    } else if (statusId === GamePhase.Halftime && prevStatusId < GamePhase.Halftime) {
      events.push({ type: "halftime", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    } else if (statusId === GamePhase.SecondHalf && prevStatusId < GamePhase.SecondHalf) {
      events.push({ type: "second_half_started", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    } else if (statusId === GamePhase.ExtraTimeFirstHalf && prevStatusId <= GamePhase.ExtraTimeFirstHalf) {
      events.push({ type: "extra_time_started", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    } else if (statusId === GamePhase.PenaltyShootout && prevStatusId <= GamePhase.PenaltyShootout) {
      events.push({ type: "penalty_shootout_started", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    } else if (statusId === GamePhase.Interrupted && prevStatusId !== GamePhase.Interrupted) {
      events.push({ type: "match_interrupted", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    } else if ([GamePhase.FirstHalf, GamePhase.SecondHalf, GamePhase.ExtraTimeFirstHalf, GamePhase.ExtraTimeSecondHalf].includes(statusId) && prevStatusId === GamePhase.Interrupted) {
      events.push({ type: "match_resumed", fixtureId: fixture.FixtureId, matchId, ts: update.Ts, seq: update.Seq });
    }
  }

  // ── Action-based events ──────────────────────────────────────────
  const team = (p?: number) => p ? teamFromParticipant(p, fixture) : null;
  const teamArg = update.Participant ? team(update.Participant) : null;

  if (action === "goal") {
    const t = teamArg ?? detectTeamFromStatDiff(prevStats, stats, [StatKey.P1Goals, StatKey.P2Goals], fixture);
    if (t) {
      const isOwn = data?.own_goal === true || data?.ownGoal === true || data?.type === "own_goal";
      events.push({
        type: isOwn ? "own_goal" : "goal_scored",
        fixtureId: fixture.FixtureId,
        matchId,
        team: t,
        ts: update.Ts,
        seq: update.Seq,
      });
    }
  } else if (action === "corner") {
    const t = teamArg ?? detectTeamFromStatDiff(prevStats, stats, [StatKey.P1Corners, StatKey.P2Corners], fixture);
    if (t) events.push({ type: "corner_awarded", fixtureId: fixture.FixtureId, matchId, team: t, ts: update.Ts, seq: update.Seq });
  } else if (action === "yellow_card") {
    const t = teamArg ?? detectTeamFromStatDiff(prevStats, stats, [StatKey.P1YellowCards, StatKey.P2YellowCards], fixture);
    if (t) events.push({ type: "card_shown", fixtureId: fixture.FixtureId, matchId, team: t, cardType: "yellow", ts: update.Ts, seq: update.Seq });
  } else if (action === "red_card" || action === "second_yellow_card") {
    const t = teamArg ?? detectTeamFromStatDiff(prevStats, stats, [StatKey.P1RedCards, StatKey.P2RedCards], fixture);
    if (t) events.push({ type: "card_shown", fixtureId: fixture.FixtureId, matchId, team: t, cardType: "red", ts: update.Ts, seq: update.Seq });
  } else if (action === "shot") {
    const t = teamArg ?? null;
    if (t) events.push({
      type: "shot_taken", fixtureId: fixture.FixtureId, matchId, team: t,
      outcome: String(data?.outcome ?? ""),
      player: String(data?.player ?? ""),
      ts: update.Ts, seq: update.Seq,
    });
  } else if (action === "substitution") {
    const t = teamArg ?? null;
    if (t) events.push({
      type: "substitution", fixtureId: fixture.FixtureId, matchId, team: t,
      playerOff: String(data?.player_off ?? data?.playerOff ?? ""),
      playerOn: String(data?.player_on ?? data?.playerOn ?? ""),
      ts: update.Ts, seq: update.Seq,
    });
  } else if (action === "var" || action === "var_review") {
    events.push({
      type: "var_review", fixtureId: fixture.FixtureId, matchId,
      decision: String(data?.decision ?? ""),
      ts: update.Ts, seq: update.Seq,
    });
  } else if (action === "free_kick") {
    const t = teamArg ?? null;
    if (t) events.push({
      type: "free_kick_awarded", fixtureId: fixture.FixtureId, matchId, team: t,
      kickType: String(data?.type ?? ""),
      ts: update.Ts, seq: update.Seq,
    });
  } else if (action === "penalty") {
    const t = teamArg ?? null;
    if (t) events.push({ type: "penalty_awarded", fixtureId: fixture.FixtureId, matchId, team: t, ts: update.Ts, seq: update.Seq });
  } else if (action && !isUsFootball && !["game_finalised", "scheduled", "fixture_updated"].includes(action)) {
    const t = teamArg ?? undefined;
    events.push({ type: "raw_action", fixtureId: fixture.FixtureId, matchId, action, team: t, data: data ?? undefined, ts: update.Ts, seq: update.Seq });
  }

  // ── US football score changes ────────────────────────────────────
  // Scoring actions (touchdown/field_goal/safety/conversions) confirm
  // into Stats keys 1/2 (P1/P2 total points) — the same keys the
  // stat-validation proofs attest. Emit goal_scored so the agent's
  // score tracking, quotes, and settle path work unchanged.
  if (isUsFootball) {
    const t = detectTeamFromStatDiff(prevStats, stats, [StatKey.P1Goals, StatKey.P2Goals], fixture);
    if (t) {
      events.push({
        type: "goal_scored",
        fixtureId: fixture.FixtureId,
        matchId,
        team: t,
        ts: update.Ts,
        seq: update.Seq,
        minute: usFootballMinute(statusId, update.Clock?.Seconds),
        // A scoring play can add 1/2/3/6/8 points — carry the real
        // totals so downstream score tracking doesn't assume +1.
        score: {
          home: stats[String(StatKey.P1Goals)] ?? 0,
          away: stats[String(StatKey.P2Goals)] ?? 0,
        },
      });
    }
  }

  return events;
}

/**
 * Approximate match minute for US football: quarters are 15-minute blocks
 * (statusId 2/4/6/8 = Q1-Q4 in play, 3/5/7 = quarter breaks, 9 = ended).
 * Clock.Seconds counts down within the current quarter when present.
 */
function usFootballMinute(statusId: number, clockSeconds?: number): number {
  const base: Record<number, number> = { 2: 0, 3: 15, 4: 15, 5: 30, 6: 30, 7: 45, 8: 45, 9: 60, 100: 60 };
  const quarterBase = base[statusId] ?? 0;
  const inPlay = statusId === 2 || statusId === 4 || statusId === 6 || statusId === 8;
  if (inPlay && typeof clockSeconds === "number") {
    return Math.round(quarterBase + (900 - clockSeconds) / 60);
  }
  return quarterBase;
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
