/**
 * TheSportsDB server-side helper — shared by /api/tsdb-event (single event)
 * and /api/tsdb-events (upcoming league list). Feeds the operator-attested
 * (matchId "tsdb:<id>") display surface (docs/ATTESTATION-ORACLE.md).
 *
 * Server-only: never touches @stoppage/txline or fs, so it stays out of the
 * client bundle. The parse/normalize logic mirrors the agent's facts adapter
 * (apps/agent/src/attest/theSportsDB.ts); keep them in sync (CLAUDE.md rule 6).
 */

const BASE = "https://www.thesportsdb.com/api/v1/json";
const API_KEY = process.env.THESPORTSDB_API_KEY ?? "3";

/** Reference leagues for the upcoming-events rail (MLS, Premier League). */
export const FEATURED_LEAGUES = [4346, 4328] as const;

export interface TsdbEvent {
  eventId: number;
  matchId: string;
  label: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: string;
  kickoffTs: number | null;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface RawEvent {
  idEvent?: string | null;
  strEvent?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strLeague?: string | null;
  strStatus?: string | null;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
}

/** TheSportsDB timestamps are UTC but often lack the Z suffix. */
export function parseKickoffTs(e: RawEvent): number | null {
  let raw =
    e.strTimestamp ??
    `${e.dateEvent ?? ""}T${(e.strTime ?? "00:00:00").replace(" ", "")}`;
  raw = raw.trim().replace(" ", "T");
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) raw += "Z";
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

export function normalizeEvent(e: RawEvent): TsdbEvent | null {
  const id = e.idEvent ? Number(e.idEvent) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  const finished = e.strStatus === "Match Finished";
  return {
    eventId: id,
    matchId: `tsdb:${id}`,
    label: e.strEvent ?? `Match ${id}`,
    homeTeam: e.strHomeTeam ?? "Home",
    awayTeam: e.strAwayTeam ?? "Away",
    league: e.strLeague ?? "Unknown",
    status: e.strStatus ?? "unknown",
    kickoffTs: parseKickoffTs(e),
    finished,
    // Carry the score whenever TheSportsDB provides it (in-play and
    // full-time), so the live hero / context card can render a real-time
    // scoreline — not just the final result.
    homeGoals: e.intHomeScore != null ? Number(e.intHomeScore) : null,
    awayGoals: e.intAwayScore != null ? Number(e.intAwayScore) : null,
  };
}

async function getJson<T>(query: string): Promise<T> {
  const res = await fetch(`${BASE}/${API_KEY}/${query}`);
  if (!res.ok) throw new Error(`TheSportsDB ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchTsdbEvent(eventId: number): Promise<TsdbEvent | null> {
  const j = await getJson<{ events: RawEvent[] | null }>(`lookupevent.php?id=${eventId}`);
  const e = j.events?.[0];
  return e ? normalizeEvent(e) : null;
}

export async function listUpcomingEvents(
  leagueIds: ReadonlyArray<number>
): Promise<TsdbEvent[]> {
  const out: TsdbEvent[] = [];
  for (const league of leagueIds) {
    const j = await getJson<{ events: RawEvent[] | null }>(
      `eventsnextleague.php?id=${league}`
    );
    for (const e of j.events ?? []) {
      const norm = normalizeEvent(e);
      if (norm) out.push(norm);
    }
  }
  return out;
}