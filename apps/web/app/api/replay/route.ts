/**
 * Replay API — server-side proxy to the agent's replay control.
 *
 * Keeps the agent URL server-side and gives the browser a same-origin
 * endpoint to launch a fixture replay through the live pipeline.
 */

import { NextRequest, NextResponse } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:8765";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fixtureId = Number(body.fixtureId);
    if (!Number.isInteger(fixtureId) || fixtureId < 1) {
      return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
    }

    const resp = await fetch(`${AGENT_API_URL}/replay/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data.error ?? "replay launch failed" }, { status: resp.status });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent unreachable" },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const resp = await fetch(`${AGENT_API_URL}/replay/status`, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: { active: false }, error: "agent unreachable" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
