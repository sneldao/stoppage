/**
 * Quotes API — proxies the agent's verifiable quote oracle (Phase 3A).
 *
 * Returns the agent's live fair-value + bid/ask reference line per market,
 * plus the re-pricing history used for the fair-value sparkline. The web app
 * re-runs the same quant model against the anchored snapshot for the
 * "Verify this price" check — this endpoint just carries the published line.
 */

import { NextRequest, NextResponse } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

export async function GET(request: NextRequest) {
  const marketId = request.nextUrl.searchParams.get("marketId");
  const url = marketId
    ? `${AGENT_API_URL}/quotes?marketId=${encodeURIComponent(marketId)}`
    : `${AGENT_API_URL}/quotes`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return NextResponse.json({ quotes: [], marketId, latest: null, history: [] }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const data = await resp.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ quotes: [], marketId, latest: null, history: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
