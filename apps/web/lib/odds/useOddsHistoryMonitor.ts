/**
 * useOddsHistoryMonitor — shared poll loop for OddsSparkline data.
 */

import { useCallback } from "react";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";
import type { OddsPoint } from "@/store/oddsHistorySlice";

const ODDS_POLL_MS = 10_000;

export function useOddsHistoryMonitor() {
  const setOddsHistory = useStoppageStore((s) => s.setOddsHistory);
  const watchCounts = useStoppageStore((s) => s.oddsWatchCounts);

  const refresh = useCallback(async () => {
    const watchlist = Object.keys(useStoppageStore.getState().oddsWatchCounts);
    if (watchlist.length === 0) return;

    await Promise.all(
      watchlist.map(async (marketId) => {
        try {
          const response = await fetch(
            `/api/odds/history?marketId=${encodeURIComponent(marketId)}`
          );
          if (!response.ok) return;
          const data = (await response.json()) as { points?: OddsPoint[] };
          setOddsHistory(marketId, data.points ?? []);
        } catch {
          // Agent offline — sparkline falls back to current odds.
        }
      })
    );
  }, [setOddsHistory]);

  usePollingWhenVisible(refresh, ODDS_POLL_MS, [watchCounts, refresh]);
}
