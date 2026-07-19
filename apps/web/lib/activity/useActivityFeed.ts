/**
 * useActivityFeedMonitor — the single SSE subscription that feeds the
 * activity slice.
 *
 * Subscribes to /api/match-events/stream (the keeper ledger SSE proxy) and
 * merges incoming MatchEvent facts with the user's own signed activity,
 * dedupes, and writes the result to the activityFeedSlice. New
 * settlement/proof/void events are pushed as toasts. If the SSE stream
 * drops or is unsupported, it falls back to a slow poll
 * (/api/match-events) so the feed never goes silent. Call ONCE from the
 * layout (ActivitySurfaces) — every consumer reads from the store.
 *
 * Boundary: read-only on the keeper ledger; controls nothing.
 */

import { useEffect, useRef } from "react";
import type { MatchEvent } from "@stoppage/sdk";
import { useStoppageStore, TOAST_KINDS } from "@/store";

export function mergeFeed(remote: MatchEvent[], local: MatchEvent[]): MatchEvent[] {
  const seen = new Set<string>();
  return [...remote, ...local]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .slice(0, 12);
}

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const FEED_SSE_URL = "/api/match-events/stream";
const FEED_POLL_URL = "/api/match-events";
const POLL_FALLBACK_MS = 15_000;
const SSE_RETRY_MS = 10_000;
const FEED_CAP = 60; // matches ledger MAX_RETURNED_EVENTS

export function useActivityFeedMonitor() {
  const activity = useStoppageStore((s) => s.activity);
  const setFeed = useStoppageStore((s) => s.setFeed);
  const pushToasts = useStoppageStore((s) => s.pushToasts);
  const remoteRef = useRef<MatchEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let pollId: number | null = null;
    let sseRetryId: number | null = null;
    let usingSSE = false;

    const applyEvents = (events: MatchEvent[]) => {
      if (cancelled || events.length === 0) return;
      remoteRef.current = events;
      setFeed(mergeFeed(events, useStoppageStore.getState().activity));
      const newToasts: MatchEvent[] = [];
      for (const e of events) {
        if (seenRef.current.has(e.id)) continue;
        seenRef.current.add(e.id);
        if (TOAST_KINDS.includes(e.kind)) newToasts.push(e);
      }
      if (newToasts.length) pushToasts(newToasts);
    };

    // Apply a single newly-streamed event by prepending to the cached
    // remote set and re-merging. Keeps the feed feeling instant.
    const applySingle = (event: MatchEvent) => {
      if (cancelled) return;
      remoteRef.current = [event, ...remoteRef.current].slice(0, FEED_CAP);
      setFeed(mergeFeed(remoteRef.current, useStoppageStore.getState().activity));
      if (!seenRef.current.has(event.id)) {
        seenRef.current.add(event.id);
        if (TOAST_KINDS.includes(event.kind)) pushToasts([event]);
      }
    };

    const refreshPoll = async () => {
      try {
        const res = await fetch(FEED_POLL_URL);
        if (!res.ok) return;
        const data = await res.json();
        applyEvents(data.events ?? []);
      } catch {
        // agent unreachable — feed stays stale
      }
    };

    const stopPoll = () => {
      if (pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    };

    const startPoll = () => {
      stopPoll();
      refreshPoll();
      pollId = window.setInterval(refreshPoll, POLL_FALLBACK_MS);
    };

    const startSSE = () => {
      try {
        es = new EventSource(FEED_SSE_URL);
      } catch {
        // EventSource unsupported — pure polling.
        startPoll();
        return;
      }

      es.onopen = () => {
        usingSSE = true;
        // SSE is live — drop the fallback poll.
        stopPoll();
      };

      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "init" && Array.isArray(data.events)) {
            applyEvents(data.events as MatchEvent[]);
          } else if (data.type === "event" && data.event) {
            applySingle(data.event as MatchEvent);
          }
          // data.type === "error" → upstream will close; onerror handles retry.
        } catch {
          // skip malformed payload
        }
      };

      es.onerror = () => {
        usingSSE = false;
        es?.close();
        es = null;
        // Fall back to polling until SSE recovers.
        if (pollId === null) startPoll();
        // Retry SSE on a delay. If it comes back, onopen stops the poll.
        if (sseRetryId === null) {
          sseRetryId = window.setTimeout(() => {
            sseRetryId = null;
            if (!cancelled && !usingSSE && es === null) startSSE();
          }, SSE_RETRY_MS);
        }
      };
    };

    // Initial fetch fills the feed immediately (before SSE connects), so the
    // first paint isn't empty.
    refreshPoll();
    startSSE();

    return () => {
      cancelled = true;
      es?.close();
      stopPoll();
      if (sseRetryId !== null) window.clearTimeout(sseRetryId);
    };
  }, [setFeed, pushToasts]);

  // Re-merge when the user's own signed activity changes.
  useEffect(() => {
    setFeed(mergeFeed(remoteRef.current, activity));
  }, [activity, setFeed]);

  return null;
}

