import { NextResponse } from "next/server";
import { fetchTsdbEvent } from "@/lib/tsdb";

/**
 * TheSportsDB event metadata for operator-attested markets
 * (matchId "tsdb:<eventId>"). Server-side proxy for the free v1 API —
 * this is the display surface for markets settled by the
 * attestation_validator oracle (docs/ATTESTATION-ORACLE.md); TxLINE
 * fixtures keep flowing through /api/fixtures.
 */

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }

  try {
    const event = await fetchTsdbEvent(Number(id));
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json(
      event,
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Event feed unavailable" },
      { status: 502 }
    );
  }
}
