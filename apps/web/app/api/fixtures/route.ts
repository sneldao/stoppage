/**
 * Fixtures API — proxies TxLINE fixture list to the client.
 *
 * Keeps TxLINE credentials server-side. The client (MatchCalendar)
 * fetches this route to display upcoming matches.
 */

import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { fetchFixtures, type Network, type TxLineCredentials } from "@stoppage/txline";

function loadCredentials(): { network: Network; creds: TxLineCredentials } {
  // The credentials file is at the monorepo root (written by scripts/subscribe-txline.ts)
  // apps/web runs from apps/web, so go up two levels.
  const credPath = /*turbopackIgnore: true*/ `${process.cwd()}/../../.txline-credentials.json`;
  const data = JSON.parse(readFileSync(credPath, "utf8"));
  return {
    network: data.network as Network,
    creds: { jwt: data.jwt, apiToken: data.apiToken },
  };
}

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
