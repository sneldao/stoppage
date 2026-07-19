/**
 * Odds history API — proxies the agent's per-market movement history.
 */

import { NextRequest, NextResponse } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

export async function GET(request: NextRequest) {
  const marketId = request.nextUrl.searchParams.get("marketId");
  if (!marketId) {
    return NextResponse.json({ error: "marketId required" }, { status: 400 });
  }
  try {
    const resp = await fetch(`${AGENT_API_URL}/odds/history?marketId=${encodeURIComponent(marketId)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return NextResponse.json({ marketId, points: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const data = await resp.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ marketId, points: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
