/**
 * TheSportsDB source adapter — the agent-side facts source for the
 * attestation oracle (v1). Boundary: an agent-side adapter, NOT part of
 * @stoppage/txline (that package is TxLINE-only per module boundaries;
 * this is a different operator data source feeding OUR OWN validator).
 *
 * Free v1 API (test key "3"; operators should set THESPORTSDB_API_KEY).
 * Useful as an operator facts source for the attestation oracle; prefer
 * TxLINE for leagues in the free bundle (MLS, Friendlies, EPL fixtures).
 *
 * Trust note: this fetches from a plain HTTPS API. The trust anchor of
 * the settlement path is NOT this HTTP call; it is the operator's ed25519
 * signature over the observation, verified on-chain. This adapter exists
 * so the operator (us, in the reference deployment) attests to facts it
 * actually checked against a public source.
 */

const BASE = "https://www.thesportsdb.com/api/v1/json";
const API_KEY = process.env.THESPORTSDB_API_KEY ?? "3";

export interface SportsDbEvent {
  idEvent: string;
  strEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strLeague: string;
  /** ISO-ish "YYYY-MM-DD HH:mm:ss" or ISO 8601, depending on endpoint. */
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
  /** e.g. "Match Finished", "Not Started", "1H", "HT". */
  strStatus: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
}

export interface ObservedMatch {
  eventId: number;
  label: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  /** Kickoff, unix seconds. */
  kickoffTs: number;
  finished: boolean;
  /** Present only when finished. */
  homeGoals?: number;
  awayGoals?: number;
}

function parseKickoff(e: SportsDbEvent): number {
  // Prefer strTimestamp; fall back to dateEvent + strTime. TheSportsDB
  // timestamps are UTC but often arrive WITHOUT the Z suffix — a bare
  // ISO string would otherwise parse as LOCAL time.
  let raw =
    e.strTimestamp ??
    `${e.dateEvent ?? ""}T${(e.strTime ?? "00:00:00").replace(" ", "")}`;
  raw = raw.trim().replace(" ", "T");
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) raw += "Z";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    throw new Error(`Unparseable kickoff time for event ${e.idEvent}: ${raw}`);
  }
  return Math.floor(ts / 1000);
}

/** Fetch a single event by TheSportsDB id. */
export async function fetchEvent(eventId: number): Promise<ObservedMatch> {
  const res = await fetch(`${BASE}/${API_KEY}/lookupevent.php?id=${eventId}`);
  if (!res.ok) throw new Error(`TheSportsDB ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { events: SportsDbEvent[] | null };
  const e = j.events?.[0];
  if (!e) throw new Error(`TheSportsDB: no event with id ${eventId}`);
  const finished = e.strStatus === "Match Finished";
  return {
    eventId: Number(e.idEvent),
    label: e.strEvent,
    homeTeam: e.strHomeTeam,
    awayTeam: e.strAwayTeam,
    league: e.strLeague,
    kickoffTs: parseKickoff(e),
    finished,
    homeGoals:
      finished && e.intHomeScore != null ? Number(e.intHomeScore) : undefined,
    awayGoals:
      finished && e.intAwayScore != null ? Number(e.intAwayScore) : undefined,
  };
}
