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
      <div className="match-calendar">
        <h2>Upcoming matches</h2>
        <p className="cal-meta">Loading fixtures…</p>
      </div>
    );
  }

  if (error || fixtures.length === 0) {
    return (
      <div className="match-calendar">
        <h2>Upcoming matches</h2>
        <p className="cal-meta">
          {error ? `Failed to load: ${error}` : "No upcoming fixtures."}
        </p>
      </div>
    );
  }

  return (
    <div className="match-calendar">
      <h2>Upcoming matches</h2>
      <div>
        {fixtures.slice(0, 8).map((f) => {
          const startTime = new Date(f.StartTime);
          const isLive = f.GameState === 2;
          const isPast = startTime < new Date();

          return (
            <div key={f.FixtureId} className="cal-fixture">
              <div className="min-w-0">
                <p className="cal-teams">
                  {f.Participant1} vs {f.Participant2}
                </p>
                <p className="cal-meta">
                  {f.Country} · {startTime.toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
                </p>
              </div>
              {isLive ? (
                <span className="cal-live shrink-0">
                  LIVE
                </span>
              ) : isPast ? (
                <span className="cal-past shrink-0">FT</span>
              ) : (
                <span className="cal-upcoming shrink-0">upcoming</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
