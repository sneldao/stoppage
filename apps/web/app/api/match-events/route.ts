import { NextRequest, NextResponse } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001";

export async function GET(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("matchId");
  const agentUrl = matchId
    ? `${AGENT_API_URL}/events?matchId=${encodeURIComponent(matchId)}`
    : `${AGENT_API_URL}/events`;

  try {
    const resp = await fetch(agentUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return NextResponse.json({ events: [], updatedAt: Date.now(), error: "agent unavailable" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const data = await resp.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ events: [], updatedAt: Date.now(), error: "agent unreachable" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
