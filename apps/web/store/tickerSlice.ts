/**
 * TickerSlice — the unified, multi-rail ticker feed.
 *
 * Replaces the single-rail MatchEvent[] feed that only showed protocol
 * events (settlements, proofs, voids). The enriched ticker merges:
 *   - protocol events (from activityFeedSlice)
 *   - odds shifts (from agentDataSlice)
 *   - fixture countdowns + live scores (from fixturesSlice)
 *   - quote repricing (from useAllQuotes)
 *   - pool totals (from marketsSlice)
 *   - SOL price + external sports fixtures (from /api/ticker/enrichment)
 *
 * The slice is write-only from the store's perspective — hooks compute
 * the merged list and call setTickerItems. CLAUDE.md: no I/O in slices.
 */

import type { StateCreator } from "zustand";

/** Source rail — determines priority and visual styling. */
export type TickerSource =
  | "protocol" // settlements, proofs, voids — highest priority
  | "odds" // sharp odds shifts
  | "quote" // fair-value repricing
  | "fixture" // kickoff countdowns, live scores
  | "pool" // locked SOL totals
  | "sol" // SOL price (external)
  | "sports" // external sports fixtures/results
  | "fact"; // always-true baseline facts

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
  quote: 70,
  fixture: 60,
  pool: 40,
  sol: 30,
  sports: 50,
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
