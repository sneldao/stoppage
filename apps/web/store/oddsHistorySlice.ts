/**
 * OddsHistorySlice — agent-recorded implied-YES history per market.
 *
 * useOddsHistoryMonitor (layout, once) polls /api/odds/history for market
 * IDs registered via watchOddsHistory. OddsSparkline registers on mount so
 * N sparklines share one poll loop instead of N intervals.
 */

import type { StateCreator } from "zustand";

export interface OddsPoint {
  ts: number;
  yes: number;
}

export interface OddsHistorySlice {
  oddsHistory: Record<string, OddsPoint[]>;
  oddsWatchCounts: Record<string, number>;
  watchOddsHistory: (marketId: string) => void;
  unwatchOddsHistory: (marketId: string) => void;
  setOddsHistory: (marketId: string, points: OddsPoint[]) => void;
}

export const createOddsHistorySlice: StateCreator<
  OddsHistorySlice,
  [],
  [],
  OddsHistorySlice
> = (set) => ({
  oddsHistory: {},
  oddsWatchCounts: {},
  watchOddsHistory: (marketId) =>
    set((state) => ({
      oddsWatchCounts: {
        ...state.oddsWatchCounts,
        [marketId]: (state.oddsWatchCounts[marketId] ?? 0) + 1,
      },
    })),
  unwatchOddsHistory: (marketId) =>
    set((state) => {
      const next = { ...state.oddsWatchCounts };
      const count = (next[marketId] ?? 0) - 1;
      if (count <= 0) delete next[marketId];
      else next[marketId] = count;
      return { oddsWatchCounts: next };
    }),
  setOddsHistory: (marketId, points) =>
    set((state) => ({
      oddsHistory: { ...state.oddsHistory, [marketId]: points },
    })),
});
