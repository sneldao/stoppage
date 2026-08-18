"use client";

/**
 * useTickerEnrichment — polls /api/ticker/enrichment for external rails
 * (SOL price, sports fixtures, on-this-day, web headlines) and pushes
 * them into the ticker via the setExternalItems callback from
 * useTickerMonitor.
 *
 * Web headlines are ungrounded press: the API tags them `source: "web"`
 * and this hook drops any other source so enrichment can never paint a
 * protocol/odds/fixture item. Proof surfaces do not read this feed.
 *
 * Polls every 90s — slower than the internal re-derivation because
 * external data changes less frequently and the API route itself caches
 * for 60s. Pauses when the tab is hidden (usePageVisible pattern).
 */

import { useCallback, useEffect, useRef } from "react";
import { usePageVisible } from "@/lib/dom/usePageVisible";
import type { TickerItem } from "@/store/tickerSlice";
import { isExternalTickerSource, priorityFor } from "@/store/tickerSlice";

const POLL_MS = 90_000;

interface EnrichmentResponse {
  items: Array<{
    id: string;
    source: string;
    label: string;
    ts: number;
  }>;
}

export function useTickerEnrichment(
  setExternalItems: (items: TickerItem[]) => void,
) {
  const pageVisible = usePageVisible();
  const setExternalRef = useRef(setExternalItems);
  setExternalRef.current = setExternalItems;

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/ticker/enrichment");
      if (!resp.ok) return;
      const data = (await resp.json()) as EnrichmentResponse;
      const items: TickerItem[] = [];
      for (const item of data.items ?? []) {
        if (!isExternalTickerSource(item.source)) continue;
        items.push({
          id: item.id,
          source: item.source,
          label: item.label,
          ts: item.ts,
          priority: priorityFor(item.source),
        });
      }
      setExternalRef.current(items);
    } catch {
      // external enrichment unavailable — ticker falls back to internal rails
    }
  }, []);

  // Initial fetch + periodic poll.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Refresh when tab becomes visible again.
  useEffect(() => {
    if (!pageVisible) return;
    void refresh();
  }, [pageVisible, refresh]);
}
