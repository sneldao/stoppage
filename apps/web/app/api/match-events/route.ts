import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import type { MatchEvent, MatchEventKind } from "@stoppage/sdk";

const MAX_EVENTS = 60;
const knownKinds = new Set<MatchEventKind>([
  "txline_observed",
  "market_created",
  "proof_validated",
  "settlement_confirmed",
  "market_voided",
  "action_failed",
]);

function isMatchEvent(value: unknown): value is MatchEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<MatchEvent>;
  return typeof event.id === "string"
    && typeof event.occurredAt === "number"
    && typeof event.matchId === "string"
    && typeof event.label === "string"
    && typeof event.kind === "string"
    && knownKinds.has(event.kind as MatchEventKind);
}

async function readEvents() {
  const path = process.env.MATCH_EVENTS_PATH ?? ".runtime/match-events.ndjson";
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value: unknown = JSON.parse(line);
          return isMatchEvent(value) ? [value] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("matchId");
  const events = await readEvents();
  const visible = matchId ? events.filter((event) => event.matchId === matchId) : events;
  return NextResponse.json({ events: visible, updatedAt: Date.now() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
