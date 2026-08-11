import { NextResponse } from "next/server";

/**
 * TheSportsDB event metadata for operator-attested markets
 * (matchId "tsdb:<eventId>"). Server-side proxy for the free v1 API —
 * this is the display surface for markets settled by the
 * attestation_validator oracle (docs/ATTESTATION-ORACLE.md); TxLINE
 * fixtures keep flowing through /api/fixtures.
 */

const BASE = "https://www.thesportsdb.com/api/v1/json";
const API_KEY = process.env.THESPORTSDB_API_KEY ?? "3";

/** TheSportsDB timestamps are UTC but often lack the Z suffix. */
function parseKickoffTs(e: {
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
}): number | null {
  let raw =
    e.strTimestamp ??
    `${e.dateEvent ?? ""}T${(e.strTime ?? "00:00:00").replace(" ", "")}`;
  raw = raw.trim().replace(" ", "T");
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) raw += "Z";
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE}/${API_KEY}/lookupevent.php?id=${id}`);
    if (!res.ok) {
      return NextResponse.json({ error: "TheSportsDB upstream error" }, { status: 502 });
    }
    const j = (await res.json()) as { events: Array<Record<string, string | null>> | null };
    const e = j.events?.[0];
    if (!e) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const finished = e.strStatus === "Match Finished";
    return NextResponse.json(
      {
        eventId: Number(e.idEvent),
        label: e.strEvent,
        homeTeam: e.strHomeTeam,
        awayTeam: e.strAwayTeam,
        league: e.strLeague,
        status: e.strStatus,
        kickoffTs: parseKickoffTs(e),
        finished,
        homeGoals: finished && e.intHomeScore != null ? Number(e.intHomeScore) : null,
        awayGoals: finished && e.intAwayScore != null ? Number(e.intAwayScore) : null,
      },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Event feed unavailable" },
      { status: 502 }
    );
  }
}
