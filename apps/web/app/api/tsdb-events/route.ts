import { NextResponse } from "next/server";
import { listUpcomingEvents, FEATURED_LEAGUES } from "@/lib/tsdb";

/**
 * Upcoming operator-attested (TheSportsDB) fixtures — MLS + Premier League.
 * This is the second match-plane the hero reads: TxLINE feeds /api/fixtures
 * (Friendlies only on the free bundle), while the "big game on Saturday"
 * (the attestation keystone, e.g. Orlando City vs FC Cincinnati) lives on
 * this plane. See docs/ATTESTATION-ORACLE.md.
 */

export async function GET() {
  try {
    const events = await listUpcomingEvents(FEATURED_LEAGUES);
    const upcoming = events
      .filter((e) => !e.finished)
      .sort((a, b) => (a.kickoffTs ?? 0) - (b.kickoffTs ?? 0));
    return NextResponse.json(
      { events: upcoming },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upstream feed unavailable" },
      { status: 502 }
    );
  }
}