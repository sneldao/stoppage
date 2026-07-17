/**
 * Event normalizer — converts raw TxLINE score updates into the
 * domain events the Stoppage agent reacts to.
 *
 * This is the bridge between TxLINE's feed format and Stoppage's
 * market logic. It is stateless — it maps one score update to zero
 * or more normalized events. The agent maintains match state across
 * updates.
 */

import type { ScoreUpdate, NormalizedEvent, Fixture } from "./types";
import { GamePhase, FINAL_STATUS_ID, StatKey } from "./types";

/**
 * Build a human-readable match ID from a fixture (e.g., "FRA-ESP").
 * Uses 3-letter country codes from team names, falling back to
 * the first 3 chars.
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
 * Derive the team name from a stat key.
 * Stat keys 1-8: odd keys = Participant1, even keys = Participant2.
 */
function teamFromStatKey(statKey: number, fixture: Fixture): string {
  const isP1 = statKey % 2 === 1; // 1,3,5,7 = P1; 2,4,6,8 = P2
  return isP1 ? fixture.Participant1 : fixture.Participant2;
}

/**
 * Normalize a raw score update into domain events.
 *
 * Returns an array because a single update might contain multiple
 * stat changes (e.g., a goal also updates the score). In practice
 * most updates map to 0 or 1 events.
 *
 * @param update - Raw TxLINE score update
 * @param fixture - The fixture this update belongs to
 * @param prevStats - Previous stats snapshot (for diffing). Null on first update.
 */
export function normalizeScoreUpdate(
  update: ScoreUpdate,
  fixture: Fixture,
  prevStats: Record<string, number> | null
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const matchId = matchIdFromFixture(fixture);
  const stats = update.Stats ?? {};
  const action = update.Action ?? "";
  const statusId = update.StatusId ?? 0;

  // Match finalised — this is the terminal event
  if (action === "game_finalised" || statusId === FINAL_STATUS_ID) {
    const p1Goals = stats[String(StatKey.P1Goals)] ?? 0;
    const p2Goals = stats[String(StatKey.P2Goals)] ?? 0;
    events.push({
      type: "match_ended",
      fixtureId: fixture.FixtureId,
      matchId,
      finalScore: { home: p1Goals, away: p2Goals },
      ts: update.Ts,
      seq: update.Seq,
    });
    return events;
  }

  // Game phase transitions
  const phase = statusId as GamePhase;
  if (phase === GamePhase.FirstHalf && prevStats === null) {
    events.push({
      type: "match_started",
      fixtureId: fixture.FixtureId,
      matchId,
      homeTeam: fixture.Participant1,
      awayTeam: fixture.Participant2,
      ts: update.Ts,
    });
  } else if (phase === GamePhase.Halftime) {
    events.push({
      type: "halftime",
      fixtureId: fixture.FixtureId,
      matchId,
      ts: update.Ts,
      seq: update.Seq,
    });
  } else if (phase === GamePhase.SecondHalf && prevStats !== null) {
    // Only emit if transitioning from halftime
    events.push({
      type: "second_half_started",
      fixtureId: fixture.FixtureId,
      matchId,
      ts: update.Ts,
      seq: update.Seq,
    });
  }

  // Stat diffs — detect goals, corners, cards by comparing to prevStats
  if (prevStats) {
    const diff = diffStats(prevStats, stats);
    for (const { key, delta } of diff) {
      if (delta <= 0) continue;

      const baseKey = key % 1000; // strip period prefix
      const team = teamFromStatKey(baseKey, fixture);

      if (baseKey === StatKey.P1Goals || baseKey === StatKey.P2Goals) {
        for (let i = 0; i < delta; i++) {
          events.push({
            type: "goal_scored",
            fixtureId: fixture.FixtureId,
            matchId,
            team,
            ts: update.Ts,
            seq: update.Seq,
          });
        }
      } else if (baseKey === StatKey.P1Corners || baseKey === StatKey.P2Corners) {
        for (let i = 0; i < delta; i++) {
          events.push({
            type: "corner_awarded",
            fixtureId: fixture.FixtureId,
            matchId,
            team,
            ts: update.Ts,
            seq: update.Seq,
          });
        }
      } else if (baseKey === StatKey.P1YellowCards || baseKey === StatKey.P2YellowCards) {
        for (let i = 0; i < delta; i++) {
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
      } else if (baseKey === StatKey.P1RedCards || baseKey === StatKey.P2RedCards) {
        for (let i = 0; i < delta; i++) {
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
    }
  }

  return events;
}

/**
 * Compute the diff between two stat snapshots.
 * Returns only keys that increased.
 */
function diffStats(
  prev: Record<string, number>,
  curr: Record<string, number>
): Array<{ key: number; delta: number }> {
  const diffs: Array<{ key: number; delta: number }> = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  for (const keyStr of allKeys) {
    const key = Number(keyStr);
    const prevVal = prev[keyStr] ?? 0;
    const currVal = curr[keyStr] ?? 0;
    const delta = currVal - prevVal;
    if (delta > 0) {
      diffs.push({ key, delta });
    }
  }

  return diffs;
}
