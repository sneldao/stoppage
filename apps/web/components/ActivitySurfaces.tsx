"use client";

import { useEffect, useRef } from "react";
import { useStoppageStore } from "@/store";
import { useActivityFeedMonitor, relTime } from "@/lib/activity/useActivityFeed";
import { useTickerMonitor } from "@/lib/ticker/useTickerMonitor";
import { useTickerEnrichment } from "@/lib/ticker/useTickerEnrichment";
import type { MatchEvent } from "@stoppage/sdk";
import type { TickerItem, TickerSource } from "@/store/tickerSlice";

/**
 * ActivitySurfaces — the protocol is alive, made visible.
 *
 * Mounts the single activity feed poll (useActivityFeedMonitor), the
 * unified ticker monitor (useTickerMonitor — merges internal rails),
 * and the external enrichment poll (useTickerEnrichment — SOL price,
 * sports fixtures, Wikipedia on-this-day). Renders the fixed-bottom
 * ticker + slide-in toasts from the store.
 *
 * ── Ticker scroll: requestAnimationFrame, not CSS keyframes ──
 *
 * The ticker uses a rAF-driven scroll instead of a CSS animation so the
 * loop is truly seamless and infinite regardless of how many items are
 * in the feed. CSS keyframe animations gap when the doubled content is
 * narrower than the viewport — with few items on devnet, that was the
 * blank-space bug. The rAF approach:
 *
 *   1. Renders N copies of the item set (N = 4, enough to overflow any
 *      reasonable screen so there's always content visible).
 *   2. Each frame, advances the scroll position by speed * deltaTime.
 *   3. When position exceeds one set's width, wraps it back by exactly
 *      one set width — the next copy is pixel-identical, so the wrap
 *      is invisible.
 *   4. Transform is applied directly to the DOM (no React re-render per
 *      frame).
 *
 * Pause behaviour:
 *   - Hover: pausedRef → stops advancing, resumes on mouseleave.
 *   - Tab hidden: document.hidden check → skips the advance (browsers
 *     also throttle rAF when hidden, this is belt-and-suspenders).
 *   - prefers-reduced-motion: animation never starts, items are static.
 *
 * New items: when the store updates, React re-renders the sets with new
 * content. The rAF loop picks up the new setWidth on the next frame and
 * keeps scrolling — no restart, no jump (or a negligible one if the set
 * width changed).
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
  fact: "OTD",
};

/** Scroll speed in pixels per second — tuned for 10px monospace text. */
const SCROLL_SPEED_PX_PER_SEC = 38;

/** Number of item-set copies rendered. 4 guarantees overflow on any
 *  screen up to ~8K with typical item widths. */
const SET_COPIES = 4;

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

function TickerSet({ items, measureRef }: { items: TickerItem[]; measureRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="global-ticker-set" ref={measureRef}>
      {items.map((item) => (
        <span key={item.id} className={`global-ticker-item global-ticker-item--${item.source}`}>
          {SOURCE_BADGE[item.source] && (
            <span className="global-ticker-badge">{SOURCE_BADGE[item.source]}</span>
          )}
          <span className="global-ticker-time">{relTime(item.ts)}</span>
          <span className="global-ticker-text">{item.label}</span>
        </span>
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

  // rAF scroll state — refs only, no React re-renders per frame.
  const trackRef = useRef<HTMLDivElement>(null);
  const setElRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef(0);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const hasItems = tickerItems.length > 0;

  useEffect(() => {
    if (!hasItems) return;

    // Respect reduced-motion users: render items statically, no scroll.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    let lastTime = performance.now();

    const animate = (time: number) => {
      const delta = (time - lastTime) / 1000;
      lastTime = time;

      // Skip advance when paused (hover) or tab hidden.
      if (!pausedRef.current && !document.hidden) {
        const setEl = setElRef.current;
        const track = trackRef.current;
        if (setEl && track) {
          const setWidth = setEl.offsetWidth;
          if (setWidth > 0) {
            positionRef.current += SCROLL_SPEED_PX_PER_SEC * delta;
            // Wrap at exactly one set width — the next copy is identical,
            // so the wrap is visually seamless.
            if (positionRef.current >= setWidth) {
              positionRef.current -= setWidth;
            }
            track.style.transform = `translateX(${-positionRef.current}px)`;
          }
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [hasItems]);

  return (
    <>
      {hasItems && (
        <div
          className="global-ticker"
          aria-label="Live activity feed"
          onMouseEnter={() => { pausedRef.current = true; }}
          onMouseLeave={() => { pausedRef.current = false; }}
        >
          <span className="global-ticker-label"><i className="live-dot" /> Live</span>
          <div className="global-ticker-track" ref={trackRef}>
            {Array.from({ length: SET_COPIES }).map((_, i) => (
              <TickerSet
                key={i}
                items={tickerItems}
                measureRef={i === 0 ? (el) => { setElRef.current = el; } : undefined}
              />
            ))}
          </div>
        </div>
      )}
      <EventToasts toasts={toasts} dismiss={dismissToast} />
    </>
  );
}
