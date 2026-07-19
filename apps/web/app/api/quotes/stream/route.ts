/**
 * Quotes SSE proxy — tunnels the agent's /quotes/stream (Phase 3A) through
 * same-origin HTTPS so the browser renders Matchkeeper's live verifiable
 * quote line in real time without Mixed Content blocks.
 *
 * Each pushed event carries a MarketQuote (fair value + bid/ask + snapshot),
 * which the focused-market UI plots as a fair-value sparkline and the
 * depth ladder consumes directly.
 */

import { NextRequest } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const upstreamUrl = `${AGENT_API_URL}/quotes/stream`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("data: {\"type\":\"error\",\"message\":\"agent unreachable\"}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response("data: {\"type\":\"error\",\"message\":\"agent unavailable\"}\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
