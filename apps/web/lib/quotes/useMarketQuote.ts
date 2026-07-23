"use client";

import { useEffect, useState } from "react";
import { usePageVisible } from "@/lib/dom/usePageVisible";
import { acquireQuoteStream } from "@/lib/quotes/quoteStream";
import type { QuoteHistoryPoint, QuotePayload } from "@/lib/quotes/types";

/** One quotes fetch + one SSE stream per market detail page. */
export function useMarketQuote(marketId: string) {
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [history, setHistory] = useState<QuoteHistoryPoint[]>([]);
  const pageVisible = usePageVisible();

  useEffect(() => {
    let cancelled = false;

    const applyQuote = (payload: QuotePayload) => {
      if (cancelled || payload.marketId !== marketId) return;
      setQuote(payload);
      setHistory((prev) => [...prev, {
        ts: payload.ts,
        fairValue: payload.result.fairValue,
        bid: payload.result.bid,
        ask: payload.result.ask,
        inventorySkew: payload.inventorySkew,
      }].slice(-120));
    };

    void fetch(`/api/quotes?marketId=${encodeURIComponent(marketId)}`)
      .then((response) => response.json())
      .then((data: { latest?: QuotePayload; history?: QuoteHistoryPoint[] }) => {
        if (cancelled) return;
        if (data.latest) setQuote(data.latest);
        if (data.history) setHistory(data.history.slice(-120));
      })
      .catch(() => {});

    const release = acquireQuoteStream((data) => {
      const payload = data as {
        type?: string;
        quote?: QuotePayload;
        quotes?: QuotePayload[];
      };
      if (payload.type === "init" && Array.isArray(payload.quotes)) {
        for (const item of payload.quotes) applyQuote(item);
      } else if (payload.type === "quote" && payload.quote) {
        applyQuote(payload.quote);
      }
    });

    return () => {
      cancelled = true;
      release();
    };
  }, [marketId]);

  useEffect(() => {
    if (pageVisible || !marketId) return;
    void fetch(`/api/quotes?marketId=${encodeURIComponent(marketId)}`)
      .then((response) => response.json())
      .then((data: { latest?: QuotePayload; history?: QuoteHistoryPoint[] }) => {
        if (data.latest?.marketId === marketId) setQuote(data.latest);
        if (data.history) setHistory(data.history.slice(-120));
      })
      .catch(() => {});
  }, [pageVisible, marketId]);

  return { quote, history };
}
