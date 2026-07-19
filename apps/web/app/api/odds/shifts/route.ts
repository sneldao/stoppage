/**
 * Odds shifts API — proxies the agent's sharp-movement detector.
 */

import { NextResponse } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

export async function GET() {
  try {
    const resp = await fetch(`${AGENT_API_URL}/odds/shifts`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return NextResponse.json({ shifts: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const data = await resp.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ shifts: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
