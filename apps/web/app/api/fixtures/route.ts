/**
 * Fixtures API — proxies TxLINE fixture list to the client.
 *
 * Keeps TxLINE credentials server-side. The client (MatchCalendar)
 * fetches this route to display upcoming matches.
 */

import { NextResponse } from "next/server";
import { fetchFixtures, loadCredentials } from "@stoppage/txline";

export async function GET() {
  try {
    const { network, creds } = loadCredentials();
    const fixtures = await fetchFixtures(network, creds);
    return NextResponse.json({ fixtures });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to fetch fixtures" },
      { status: 500 }
    );
  }
}
