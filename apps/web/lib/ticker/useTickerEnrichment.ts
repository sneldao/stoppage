"use client";

/**
 * useTickerEnrichment — polls /api/ticker/enrichment for external rails
 * (SOL price, sports fixtures) and pushes them into the ticker via
 * the setExternalItems callback from useTickerMonitor.
 *
 * Polls every 90s — slower than the internal re-derivation because
 * external data changes less frequently and the API route itself caches
 * for 60s. Pauses when the tab is hidden (usePageVisible pattern).
 */

import { useCallback, useEffect, useRef } from "react";
import { usePageVisible } from "@/lib/dom/usePageVisible";
import type { TickerItem } from "@/store/tickerSlice";
import { priorityFor } from "@/store/tickerSlice";

const POLL_MS = 90_000;

interface EnrichmentResponse {
  items: Array<{
    id: string;
    source: "sol" | "sports";
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
      const items: TickerItem[] = (data.items ?? []).map((item) => ({
        id: item.id,
        source: item.source,
        label: item.label,
        ts: item.ts,
        priority: priorityFor(item.source),
      }));
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
