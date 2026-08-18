/**
 * TickerSlice — the unified, multi-rail ticker feed.
 *
 * Replaces the single-rail MatchEvent[] feed that only showed protocol
 * events (settlements, proofs, voids). The enriched ticker merges:
 *   - protocol events (from activityFeedSlice)
 *   - odds shifts (from agentDataSlice)
 *   - fixture countdowns + live scores (from fixturesSlice)
 *   - the keystone campaign rail (from lib/campaign/keystone.ts)
 *   - pool totals (from marketsSlice)
 *   - SOL price, sports fixtures, on-this-day, and web headlines
 *     (from /api/ticker/enrichment). Web is decorative only — never
 *     treated as a verified result.
 *
 * The slice is write-only from the store's perspective — hooks compute
 * the merged list and call setTickerItems. CLAUDE.md: no I/O in slices.
 */

import type { StateCreator } from "zustand";

/** External rails from /api/ticker/enrichment — the client whitelist. */
export const EXTERNAL_TICKER_SOURCES = ["sol", "sports", "fact", "web"] as const;
export type ExternalTickerSource = (typeof EXTERNAL_TICKER_SOURCES)[number];

export function isExternalTickerSource(value: string): value is ExternalTickerSource {
  return (EXTERNAL_TICKER_SOURCES as readonly string[]).includes(value);
}

/** Source rail — determines priority and visual styling. */
export type TickerSource =
  | "protocol" // settlements, proofs, voids — highest priority
  | "odds" // sharp odds shifts
  | "fixture" // kickoff countdowns, live scores
  | "pool" // locked SOL totals
  | ExternalTickerSource;

export interface TickerItem {
  /** Stable dedup key — e.g. "protocol:abc123" or "sol:price". */
  id: string;
  source: TickerSource;
  /** Human-readable label shown in the ticker. */
  label: string;
  /** Event timestamp (ms since epoch) for relative-time display. */
  ts: number;
  /** Sort priority within the same timestamp — higher wins. */
  priority: number;
}

export interface TickerSlice {
  /** Merged, sorted ticker items. */
  tickerItems: TickerItem[];
  setTickerItems: (items: TickerItem[]) => void;
}

const SOURCE_PRIORITY: Record<TickerSource, number> = {
  protocol: 100,
  odds: 80,
  fixture: 60,
  pool: 40,
  sol: 30,
  sports: 50,
  web: 20, // ungrounded press — above OTD facts, never above protocol/fixtures
  fact: 10,
};

/** Sort by timestamp desc, then priority desc. */
export function sortTickerItems(a: TickerItem, b: TickerItem): number {
  if (b.ts !== a.ts) return b.ts - a.ts;
  return b.priority - a.priority;
}

/** Assign priority from the source rail. */
export function priorityFor(source: TickerSource): number {
  return SOURCE_PRIORITY[source] ?? 0;
}

export const createTickerSlice: StateCreator<
  TickerSlice,
  [],
  [],
  TickerSlice
> = (set) => ({
  tickerItems: [],
  setTickerItems: (tickerItems) => set({ tickerItems }),
});
