/**
 * Fixtures API — proxies TxLINE fixture list to the client.
 *
 * Keeps TxLINE credentials server-side. Each fixture includes a server-
 * computed `replayable` flag (finished phase + historical scores exist)
 * so the client never auto-launches replays the agent would reject.
 * Scoped to the free-bundle competitions (MLS, Friendlies, EPL).
 */

import { NextResponse } from "next/server";
import {
  attachReplayableFlags,
  fetchFixturesForCompetitions,
  FREE_BUNDLE_COMPETITIONS,
  loadCredentials,
  matchIdFromFixture,
  type FixtureWithReplayable,
} from "@stoppage/txline";

const CACHE_TTL_MS = 60_000;

let cache: {
  at: number;
  fixtures: Array<FixtureWithReplayable & { matchId: string }>;
} | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(
        { fixtures: cache.fixtures },
        { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
      );
    }

    const { network, creds } = loadCredentials();
    const fixtures = await fetchFixturesForCompetitions(
      network,
      creds,
      FREE_BUNDLE_COMPETITIONS
    );
    const enriched = await attachReplayableFlags(network, creds, fixtures);
    const payload = enriched.map((fixture) => ({
      ...fixture,
      matchId: matchIdFromFixture(fixture),
    }));
    cache = { at: Date.now(), fixtures: payload };
    return NextResponse.json(
      { fixtures: payload },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (e) {
    // Forward TxLINE's status (401 stale creds, 429 rate limit) instead of
    // a blanket 500 — the client backs off by status, and operators can
    // tell a credential lapse from a rate limit at a glance.
    const message = e instanceof Error ? e.message : "failed to fetch fixtures";
    const upstream = /failed: (\d{3})/.exec(message)?.[1];
    const status = upstream === "401" || upstream === "429" ? Number(upstream) : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
