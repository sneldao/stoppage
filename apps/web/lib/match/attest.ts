import type { Fixture } from "@stoppage/txline";
import type { LiveMatchSnapshot } from "@/lib/match/types";

/**
 * Shared helpers for the operator-attested (TheSportsDB) match plane.
 *
 * Markets created by the attestation keeper carry matchId "tsdb:<eventId>".
 * They never resolve against the TxLINE fixture list, so every surface
 * (home hero, /match desk, markets tape, picker) resolves a "tsdb:*" matchId
 * to the same synthetic Fixture + live snapshot. Docs/ATTESTATION-ORACLE.md.
 */

export interface AttestEventInfo {
  eventId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  /** Unix seconds. */
  kickoffTs: number | null;
  finished: boolean;
  inPlay: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
}

export function isAttestMatchId(matchId: string | null | undefined): boolean {
  return !!matchId && matchId.startsWith("tsdb:");
}

/** Event id parsed out of a "tsdb:<id>" matchId, or null. */
export function eventIdFromMatchId(matchId: string | null | undefined): number | null {
  if (!isAttestMatchId(matchId)) return null;
  const id = Number(matchId!.slice("tsdb:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Derive started/in-play from a kickoff clock. */
export function deriveAttestState(e: {
  kickoffTs?: number | null;
  finished?: boolean;
}): { started: boolean; inPlay: boolean } {
  const started = !!e.kickoffTs && e.kickoffTs * 1000 <= Date.now();
  return { started, inPlay: !e.finished && started };
}

/** Map a /api/tsdb-event(s) JSON object to the shared shape. */
export function toAttestInfo(raw: {
  eventId?: number;
  matchId?: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  kickoffTs?: number | null;
  finished?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
}): AttestEventInfo {
  return {
    eventId: raw.eventId ?? 0,
    matchId: raw.matchId ?? `tsdb:${raw.eventId ?? 0}`,
    homeTeam: raw.homeTeam ?? "Home",
    awayTeam: raw.awayTeam ?? "Away",
    league: raw.league ?? "Unknown",
    kickoffTs: raw.kickoffTs ?? null,
    finished: !!raw.finished,
    // In-play is clock-derived, not carried by the API shape.
    inPlay: false,
    homeGoals: raw.homeGoals ?? null,
    awayGoals: raw.awayGoals ?? null,
  };
}

/** Synthesize a Fixture so existing countdown/scoreline machinery works. */
export function attestEventToFixture(e: AttestEventInfo): Fixture | null {
  if (!e.kickoffTs) return null;
  return {
    FixtureId: e.eventId,
    Participant1: e.homeTeam,
    Participant2: e.awayTeam,
    Country: e.league,
    // 1 = scheduled (countdown), 2 = first half (live), 5 = finished.
    GameState: e.finished ? 5 : e.inPlay ? 2 : 1,
    StartTime: new Date(e.kickoffTs * 1000).toISOString(),
    matchId: e.matchId,
  } as unknown as Fixture;
}

/** Live snapshot (real score) once the match is in play. */
export function attestEventToSnapshot(
  e: AttestEventInfo,
  now: number = Date.now()
): LiveMatchSnapshot | null {
  if (!e.inPlay || e.homeGoals == null || e.awayGoals == null) return null;
  return {
    updatedAt: now,
    score: { home: e.homeGoals, away: e.awayGoals },
    stats: { corners: 0, cards: 0 },
  };
}