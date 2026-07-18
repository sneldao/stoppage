import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { dirname } from "path";
import type { MatchEvent } from "@stoppage/sdk";

const MAX_LEDGER_BYTES = 1_000_000;

/**
 * Small durable bridge between the PM2 keeper and the read-only web runtime.
 * NDJSON keeps writes atomic enough for this single-writer devnet deployment
 * and stays inspectable without a database dependency.
 */
export class MatchEventLedger {
  constructor(private readonly filePath: string) {}

  append(event: Omit<MatchEvent, "id">) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.rotateIfNeeded();
    const entry: MatchEvent = {
      ...event,
      id: `${event.occurredAt}-${Math.random().toString(36).slice(2, 8)}`,
    };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o644 });
  }

  private rotateIfNeeded() {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < MAX_LEDGER_BYTES) return;
    renameSync(this.filePath, `${this.filePath}.1`);
  }
}

export function createMatchEventLedger() {
  return new MatchEventLedger(process.env.MATCH_EVENTS_PATH ?? ".runtime/match-events.ndjson");
}
