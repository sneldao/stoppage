"use client";

import Link from "next/link";
import type { QuotePayload } from "@/lib/quotes/types";

interface ModelQuoteStripProps {
  quotes: QuotePayload[];
  streaming: boolean;
  /** When set, positions the strip as the page hero instrument. */
  hero?: boolean;
}

export function ModelQuoteStrip({ quotes, streaming, hero = false }: ModelQuoteStripProps) {
  const visible = quotes.slice(0, 6);
  const lastTick = quotes[0]?.ts;

  return (
    <div
      className={`model-quote-strip${hero ? " model-quote-strip--hero" : ""}`}
      aria-live="polite"
    >
      <span className="model-quote-strip__status">
        <i className={streaming ? "live-dot" : "schedule-dot"} />
        {streaming ? "Model feed live" : "Model feed reconnecting"}
        {quotes.length > 0 && (
          <small>
            {quotes.length} line{quotes.length !== 1 ? "s" : ""}
            {lastTick
              ? ` · ${new Date(lastTick).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
              : ""}
          </small>
        )}
      </span>
      <div className="model-quote-strip__pills">
        {visible.length === 0 ? (
          <span className="model-quote-strip__empty">No live quotes yet</span>
        ) : (
          visible.map((q) => (
            <Link key={q.marketId} href={`/markets/${q.marketId}`} className="model-quote-pill">
              <span className="model-quote-pill__label">{q.label}</span>
              <strong key={q.ts} className="score-flash">
                {Math.round(q.result.fairValue * 100)}¢
              </strong>
              <small>{q.result.modelVersion}</small>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
