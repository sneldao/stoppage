"use client";

import { useEffect } from "react";
import { useStoppageStore } from "@/store";
import { useActivityFeedMonitor, relTime } from "@/lib/activity/useActivityFeed";
import { useTickerMonitor } from "@/lib/ticker/useTickerMonitor";
import { useTickerEnrichment } from "@/lib/ticker/useTickerEnrichment";
import type { MatchEvent } from "@stoppage/sdk";
import type { TickerSource } from "@/store/tickerSlice";

/**
 * ActivitySurfaces — the protocol is alive, made visible.
 *
 * Mounts the single activity feed poll (useActivityFeedMonitor), the
 * unified ticker monitor (useTickerMonitor — merges internal rails),
 * and the external enrichment poll (useTickerEnrichment — SOL price,
 * sports fixtures). Renders the fixed-bottom ticker + slide-in toasts
 * from the store. Other consumers (RightNowLine, etc.) read the same
 * store slices — no double-polling.
 *
 * The ticker always renders when there are items from any rail. If the
 * agent is unreachable, the internal protocol rail stays empty but
 * external rails (SOL price, sports) keep the ticker populated.
 */

const TOAST_BADGE: Record<string, string> = {
  settlement_confirmed: "✓ Settled",
  proof_validated: "✓ Proof verified",
  market_voided: "Void",
};

const SOURCE_BADGE: Record<TickerSource, string> = {
  protocol: "",
  odds: "ODDS",
  quote: "QUOTE",
  fixture: "MATCH",
  pool: "TVL",
  sol: "SOL",
  sports: "SPORT",
  fact: "",
};

function EventToasts({ toasts, dismiss }: { toasts: MatchEvent[]; dismiss: (id: string) => void }) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), 7_000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [toasts, dismiss]);

  return (
    <div className="event-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`event-toast event-toast--${t.kind}`} onClick={() => dismiss(t.id)} role="status">
          <span className="event-toast-badge">{TOAST_BADGE[t.kind] ?? t.kind}</span>
          <span className="event-toast-text">{t.label}</span>
          {t.signature && (
            <a className="event-toast-link" href={`https://explorer.solana.com/tx/${t.signature}?cluster=devnet`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>view ↗</a>
          )}
        </div>
      ))}
    </div>
  );
}

export function ActivitySurfaces() {
  useActivityFeedMonitor();
  const { setExternalItems } = useTickerMonitor();
  useTickerEnrichment(setExternalItems);
  const tickerItems = useStoppageStore((s) => s.tickerItems);
  const toasts = useStoppageStore((s) => s.toasts);
  const dismissToast = useStoppageStore((s) => s.dismissToast);

  return (
    <>
      {tickerItems.length > 0 && (
        <div className="global-ticker" aria-label="Live activity feed">
          <span className="global-ticker-label"><i className="live-dot" /> Live</span>
          <div className="global-ticker-track">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={`${item.id}-${i}`} className={`global-ticker-item global-ticker-item--${item.source}`}>
                {SOURCE_BADGE[item.source] && (
                  <span className="global-ticker-badge">{SOURCE_BADGE[item.source]}</span>
                )}
                <span className="global-ticker-time">{relTime(item.ts)}</span>
                <span className="global-ticker-text">{item.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <EventToasts toasts={toasts} dismiss={dismissToast} />
    </>
  );
}
