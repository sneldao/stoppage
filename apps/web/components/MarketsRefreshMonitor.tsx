"use client";

import { useEffect } from "react";
import { useMarkets } from "@/lib/markets/useMarkets";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";

const MARKETS_POLL_MS = 12_000;

/**
 * Fallback market refresh when Helius live feed is unavailable.
 */
export function MarketsRefreshMonitor() {
  const feedState = useStoppageStore((s) => s.feedState);
  const { refresh } = useMarkets();

  useEffect(() => {
    if (feedState === "connected") return;
    void refresh();
  }, [feedState, refresh]);

  usePollingWhenVisible(refresh, MARKETS_POLL_MS, [refresh], feedState !== "connected");

  return null;
}
