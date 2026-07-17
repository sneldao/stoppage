"use client";

import { useEffect, useState } from "react";
import type { Fixture } from "@stoppage/txline";

/**
 * Match calendar — shows upcoming fixtures from TxLINE.
 *
 * Fetches the fixture list from the TxLINE API via the web app's
 * server-side API route (keeps credentials off the client).
 */
export function MatchCalendar() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/fixtures");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setFixtures(data.fixtures ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-medium text-neutral-400">Upcoming matches</h2>
        <p className="mt-2 text-xs text-neutral-600">Loading fixtures…</p>
      </div>
    );
  }

  if (error || fixtures.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-medium text-neutral-400">Upcoming matches</h2>
        <p className="mt-2 text-xs text-neutral-600">
          {error ? `Failed to load: ${error}` : "No upcoming fixtures."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-medium text-neutral-400">Upcoming matches</h2>
      <div className="mt-3 space-y-2">
        {fixtures.slice(0, 8).map((f) => {
          const startTime = new Date(f.StartTime);
          const isLive = f.GameState === 2;
          const isPast = startTime < new Date();

          return (
            <div
              key={f.FixtureId}
              className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {f.Participant1} vs {f.Participant2}
                </p>
                <p className="text-neutral-600">
                  {f.Country} · {startTime.toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
                </p>
              </div>
              {isLive ? (
                <span className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-400">
                  LIVE
                </span>
              ) : isPast ? (
                <span className="shrink-0 text-neutral-700">FT</span>
              ) : (
                <span className="shrink-0 text-neutral-600">upcoming</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
