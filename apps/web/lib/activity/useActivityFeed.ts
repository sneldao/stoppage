/**
 * useActivityFeed — the protocol's pulse, surfaced globally.
 *
 * Polls /api/match-events (the keeper ledger, no matchId filter = all
 * recent observable facts) on a slow cadence and merges with the user's
 * own signed activity from the store. New settlement/proof events become
 * toasts; the recent merged stream feeds the global ticker.
 *
 * Boundary: this is a frontend orchestrator. It writes nothing to the
 * keeper ledger and controls nothing — /api/match-events is read-only.
 */

import { useEffect, useRef, useState } from "react";
import type { MatchEvent } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";

const TOAST_KINDS: MatchEvent["kind"][] = [
  "settlement_confirmed",
  "proof_validated",
  "market_voided",
];

export function useActivityFeed() {
  const activity = useStoppageStore((s) => s.activity);
  const [remote, setRemote] = useState<MatchEvent[]>([]);
  const [toasts, setToasts] = useState<MatchEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/match-events");
        if (!res.ok) return;
        const data = await res.json();
        const events: MatchEvent[] = data.events ?? [];
        if (cancelled) return;
        setRemote(events);
        const newToasts: MatchEvent[] = [];
        for (const e of events) {
          if (seenRef.current.has(e.id)) continue;
          seenRef.current.add(e.id);
          if (TOAST_KINDS.includes(e.kind)) newToasts.push(e);
        }
        if (newToasts.length) setToasts((prev) => [...newToasts, ...prev].slice(0, 4));
      } catch {
        // agent unreachable — feed just stays stale; ticker hides itself
      }
    };
    refresh();
    const id = window.setInterval(refresh, 8_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // Merge remote keeper events with the user's own signed activity, dedupe,
  // newest first.
  const merged = [...remote, ...activity];
  const seen = new Set<string>();
  const feed = merged
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .slice(0, 12);

  return { feed, toasts, dismissToast };
}

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
