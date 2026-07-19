/**
 * SSE proxy for the activity feed — tunnels the agent's
 * /events/feed/stream endpoint through same-origin HTTPS so the browser
 * is never blocked by Mixed Content restrictions.
 *
 * Streams MatchEvent ledger facts (market_created, settlement_confirmed,
 * decision_logged, etc.) as they are appended. This is what makes the
 * global activity ticker, the toasts, and the Matchkeeper timeline
 * real-time instead of polled. Mirrors /api/events/stream (which carries
 * LiveStore phase events); this one carries ledger facts — same plumbing,
 * different upstream path.
 */

import { NextRequest } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const upstreamUrl = `${AGENT_API_URL}/events/feed/stream`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
      // No timeout — SSE is long-lived.
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

  // Pipe the upstream SSE body straight through — no buffering.
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering if behind a proxy.
    },
  });
}
