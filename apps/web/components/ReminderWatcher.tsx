"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { dueReminders, loadNotified, loadReminders, markNotified, pruneReminders } from "@/lib/reminders";

const CHECK_MS = 30_000;

/**
 * ReminderWatcher — fires gate-open reminders. Mount once per page that
 * has fixtures (home, match room); idempotent across mounts because
 * firing is recorded in localStorage, dismissal per session in state.
 */
export function ReminderWatcher({ fixtures }: { fixtures: FixtureWithMatchId[] }) {
  const [fired, setFired] = useState<FixtureWithMatchId[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const check = useCallback(() => {
    if (fixtures.length === 0) return;
    const reminded = pruneReminders(fixtures);
    if (reminded.length === 0) return;
    const due = dueReminders(fixtures, reminded, loadNotified());
    if (due.length === 0) return;
    for (const f of due) {
      markNotified(f.matchId);
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Betting open", { body: `${f.Participant1} v ${f.Participant2} — one-tap ready on Stoppage.` });
        } catch {
          // Headless/embedded contexts may reject — banner covers it.
        }
      }
    }
    setFired((prev) => {
      const known = new Set(prev.map((f) => f.matchId));
      return [...prev, ...due.filter((f) => !known.has(f.matchId))];
    });
  }, [fixtures]);

  useEffect(() => {
    check();
    const id = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(id);
  }, [check]);

  const visible = fired.filter((f) => !dismissed.has(f.matchId));
  if (visible.length === 0) return null;

  return (
    <div className="reminder-banner" role="alert" aria-live="polite">
      {visible.slice(0, 2).map((f) => (
        <div className="reminder-row" key={f.matchId}>
          <span>
            <strong>Betting open:</strong> {f.Participant1} v {f.Participant2} — one-tap ready.
          </span>
          <Link href={`/match?match=${encodeURIComponent(f.matchId)}`}>Open room →</Link>
          <button
            type="button"
            aria-label="Dismiss reminder"
            onClick={() => setDismissed((prev) => new Set(prev).add(f.matchId))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
