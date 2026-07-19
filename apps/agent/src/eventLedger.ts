import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "fs";
import { dirname } from "path";
import type { MatchEvent } from "@stoppage/sdk";

const MAX_LEDGER_BYTES = 1_000_000;
const MAX_RETURNED_EVENTS = 60;

/**
 * Small durable bridge between the PM2 keeper and the read-only web runtime.
 * NDJSON keeps writes atomic enough for this single-writer devnet deployment
 * and stays inspectable without a database dependency.
 */
export class MatchEventLedger {
  private subscribers = new Set<(event: MatchEvent) => void>();

  constructor(private readonly filePath: string) {}

  /** Subscribe to live appends. Returns an unsubscribe function. */
  subscribe(cb: (event: MatchEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  append(event: Omit<MatchEvent, "id">) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.rotateIfNeeded();
    const entry: MatchEvent = {
      ...event,
      id: `${event.occurredAt}-${Math.random().toString(36).slice(2, 8)}`,
    };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o644 });
    // Push to live SSE subscribers. Isolated try/catch so a slow/dead
    // client never blocks the single writer or corrupts the file.
    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch {
        this.subscribers.delete(sub);
      }
    }
  }

  readEvents(): MatchEvent[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const raw = readFileSync(this.filePath, "utf8");
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
        .slice(0, MAX_RETURNED_EVENTS);
    } catch {
      return [];
    }
  }

  private rotateIfNeeded() {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < MAX_LEDGER_BYTES) return;
    renameSync(this.filePath, `${this.filePath}.1`);
  }
}

function isMatchEvent(value: unknown): value is MatchEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<MatchEvent>;
  return typeof event.id === "string"
    && typeof event.occurredAt === "number"
    && typeof event.matchId === "string"
    && typeof event.label === "string"
    && typeof event.kind === "string";
}

export function createMatchEventLedger() {
  return new MatchEventLedger(process.env.MATCH_EVENTS_PATH ?? ".runtime/match-events.ndjson");
}
