"use client";

import { useEffect } from "react";
import { useStoppageStore } from "@/store";
import { useActivityFeedMonitor, relTime } from "@/lib/activity/useActivityFeed";
import type { MatchEvent } from "@stoppage/sdk";

/**
 * ActivitySurfaces — the protocol is alive, made visible.
 *
 * Mounts the single activity feed poll (useActivityFeedMonitor) and renders
 * the fixed-bottom ticker + slide-in toasts from the store. Other consumers
 * (RightNowLine, etc.) read the same store slice — no double-polling.
 * Renders nothing if the agent is unreachable — the feed stays empty and
 * both surfaces hide themselves.
 */

const TOAST_BADGE: Record<string, string> = {
  settlement_confirmed: "✓ Settled",
  proof_validated: "✓ Proof verified",
  market_voided: "Void",
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
  const feed = useStoppageStore((s) => s.feed);
  const toasts = useStoppageStore((s) => s.toasts);
  const dismissToast = useStoppageStore((s) => s.dismissToast);

  return (
    <>
      {feed.length > 0 && (
        <div className="global-ticker" aria-label="Live protocol activity">
          <span className="global-ticker-label"><i className="live-dot" /> Live</span>
          <div className="global-ticker-track">
            {[...feed, ...feed].map((e, i) => (
              <span key={`${e.id}-${i}`} className="global-ticker-item">
                <span className="global-ticker-time">{relTime(e.occurredAt)}</span>
                <span className="global-ticker-text">{e.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <EventToasts toasts={toasts} dismiss={dismissToast} />
    </>
  );
}
