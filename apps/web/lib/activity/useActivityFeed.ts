/**
 * useActivityFeedMonitor — the single poll that feeds the activity slice.
 *
 * Polls /api/match-events (the keeper ledger, no matchId = all recent
 * observable facts) on a slow cadence, merges with the user's own signed
 * activity, dedupes, and writes the result to the activityFeedSlice. New
 * settlement/proof/void events are pushed as toasts. Call ONCE from the
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

export function useActivityFeedMonitor() {
  const activity = useStoppageStore((s) => s.activity);
  const setFeed = useStoppageStore((s) => s.setFeed);
  const pushToasts = useStoppageStore((s) => s.pushToasts);
  const remoteRef = useRef<MatchEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Fetch remote keeper events on a slow cadence.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/match-events");
        if (!res.ok) return;
        const data = await res.json();
        const events: MatchEvent[] = data.events ?? [];
        if (cancelled) return;
        remoteRef.current = events;
        setFeed(mergeFeed(events, useStoppageStore.getState().activity));
        const newToasts: MatchEvent[] = [];
        for (const e of events) {
          if (seenRef.current.has(e.id)) continue;
          seenRef.current.add(e.id);
          if (TOAST_KINDS.includes(e.kind)) newToasts.push(e);
        }
        if (newToasts.length) pushToasts(newToasts);
      } catch {
        // agent unreachable — feed just stays stale
      }
    };
    refresh();
    const id = window.setInterval(refresh, 8_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [setFeed, pushToasts]);

  // Re-merge when the user's own signed activity changes.
  useEffect(() => {
    setFeed(mergeFeed(remoteRef.current, activity));
  }, [activity, setFeed]);

  return null;
}
