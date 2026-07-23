"use client";

import { useEffect, useState } from "react";
import { acquireQuoteStream, subscribeQuoteStreamConnection } from "@/lib/quotes/quoteStream";
import type { QuotePayload } from "@/lib/quotes/types";

export interface AllQuotesState {
  quotes: QuotePayload[];
  streaming: boolean;
}

function applyQuote(prev: QuotePayload[], quote: QuotePayload) {
  const next = prev.filter((q) => q.marketId !== quote.marketId);
  next.push(quote);
  return next.sort((a, b) => b.ts - a.ts);
}

export function useAllQuotes(): AllQuotesState {
  const [quotes, setQuotes] = useState<QuotePayload[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/quotes")
      .then((response) => response.json())
      .then((data: { quotes?: QuotePayload[] }) => {
        if (cancelled) return;
        if (Array.isArray(data.quotes)) setQuotes(data.quotes);
      })
      .catch(() => {});

    const releaseConnection = subscribeQuoteStreamConnection((connected) => {
      if (!cancelled) setStreaming(connected);
    });

    const releaseStream = acquireQuoteStream((data) => {
      const payload = data as {
        type?: string;
        quote?: QuotePayload;
        quotes?: QuotePayload[];
      };
      if (payload.type === "init" && Array.isArray(payload.quotes)) {
        const quotes = payload.quotes;
        setQuotes((prev) => quotes.reduce(applyQuote, [...prev]));
      } else if (payload.type === "quote" && payload.quote) {
        const quote = payload.quote;
        setQuotes((prev) => applyQuote(prev, quote));
      }
    });

    return () => {
      cancelled = true;
      releaseStream();
      releaseConnection();
    };
  }, []);

  return { quotes, streaming };
}
