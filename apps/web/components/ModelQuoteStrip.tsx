"use client";

import type { QuotePayload } from "@/lib/quotes/types";

interface ModelQuoteStripProps {
  quotes: QuotePayload[];
  streaming: boolean;
}

export function ModelQuoteStrip({ quotes, streaming }: ModelQuoteStripProps) {
  const visible = quotes.slice(0, 6);

  return (
    <div className="model-quote-strip" aria-live="polite">
      <span className="model-quote-strip__status">
        <i className={streaming ? "live-dot" : "schedule-dot"} />
        {streaming ? "Model feed live" : "Model feed reconnecting"}
      </span>
      <div className="model-quote-strip__pills">
        {visible.length === 0 ? (
          <span className="model-quote-strip__empty">No live quotes yet</span>
        ) : (
          visible.map((q) => (
            <span key={q.marketId} className="model-quote-pill">
              <span className="model-quote-pill__label">{q.label}</span>
              <strong key={q.ts} className="score-flash">
                {Math.round(q.result.fairValue * 100)}¢
              </strong>
              <small>{q.result.modelVersion}</small>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
