/**
 * Fixtures API — proxies TxLINE fixture list to the client.
 *
 * Keeps TxLINE credentials server-side. Each fixture includes a server-
 * computed `replayable` flag (finished phase + historical scores exist)
 * so the client never auto-launches replays the agent would reject.
 */

import { NextResponse } from "next/server";
import {
  attachReplayableFlags,
  fetchFixtures,
  loadCredentials,
  matchIdFromFixture,
} from "@stoppage/txline";

export async function GET() {
  try {
    const { network, creds } = loadCredentials();
    const fixtures = await fetchFixtures(network, creds);
    const enriched = await attachReplayableFlags(network, creds, fixtures);
    return NextResponse.json({
      fixtures: enriched.map((fixture) => ({
        ...fixture,
        matchId: matchIdFromFixture(fixture),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to fetch fixtures" },
      { status: 500 }
    );
  }
}
