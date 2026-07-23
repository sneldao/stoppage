import { useEffect } from "react";
import { useStoppageStore } from "@/store";
import type { OddsPoint } from "@/store/oddsHistorySlice";

const EMPTY_ODDS_HISTORY: OddsPoint[] = [];

/** Register a market for shared odds-history polling when enabled. */
export function useOddsHistory(marketId: string, enabled = true): OddsPoint[] {
  const watchOddsHistory = useStoppageStore((s) => s.watchOddsHistory);
  const unwatchOddsHistory = useStoppageStore((s) => s.unwatchOddsHistory);
  const points = useStoppageStore((s) => s.oddsHistory[marketId] ?? EMPTY_ODDS_HISTORY);

  useEffect(() => {
    if (!enabled) return;
    watchOddsHistory(marketId);
    return () => unwatchOddsHistory(marketId);
  }, [marketId, enabled, watchOddsHistory, unwatchOddsHistory]);

  return points;
}
