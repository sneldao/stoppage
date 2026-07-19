/**
 * SSE proxy — tunnels the agent's /events/stream endpoint through HTTPS
 * so the client is never blocked by Mixed Content restrictions.
 *
 * The agent lives on http:// (plain HTTP server-side); this route fetches
 * from it server-side and pipes the stream to the browser over HTTPS.
 */

import { NextRequest } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://144.202.117.160:18766";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("matchId");
  const upstreamUrl = new URL(`${AGENT_API_URL}/events/stream`);
  if (matchId) upstreamUrl.searchParams.set("matchId", matchId);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
      // Don't set a timeout — SSE is long-lived
    });
  } catch {
    // Agent unreachable — return an empty SSE stream that closes immediately
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

  // Pipe the upstream SSE body straight through — no buffering
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering if behind a proxy
    },
  });
}
