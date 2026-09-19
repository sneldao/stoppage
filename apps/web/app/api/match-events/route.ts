import { NextRequest, NextResponse } from "next/server";
import type { MatchEvent } from "@stoppage/sdk";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

// Last-good snapshot, module scope — survives across invocations inside a
// warm function instance. The keeper's HTTP server flaps when its event
// loop is busy; when it does, visitors should still see the last real
// ledger facts rather than an empty feed. Every event carries its own
// occurredAt, so "last action N min ago" stays honest under staleness.
let lastGood: { events: MatchEvent[]; updatedAt: number } | null = null;

export async function GET(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("matchId");
  const agentUrl = matchId
    ? `${AGENT_API_URL}/events?matchId=${encodeURIComponent(matchId)}`
    : `${AGENT_API_URL}/events`;

  try {
    const resp = await fetch(agentUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`agent ${resp.status}`);
    const data = await resp.json();
    if (Array.isArray(data.events)) {
      if (!matchId) lastGood = data;
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw new Error("agent returned no events");
  } catch {
    if (lastGood) {
      const events = matchId
        ? lastGood.events.filter((e) => e.matchId === matchId)
        : lastGood.events;
      return NextResponse.json(
        { events, updatedAt: lastGood.updatedAt, stale: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ events: [], updatedAt: Date.now(), error: "agent unreachable" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
