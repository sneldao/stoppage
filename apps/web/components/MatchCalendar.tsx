"use client";

import { useFixtures } from "@/lib/match/useFixtures";

/**
 * Match calendar — shows upcoming fixtures from TxLINE.
 *
 * Reads from the shared fixtures store (FixturesMonitor) instead of
 * fetching independently.
 */
export function MatchCalendar() {
  const { fixtures, fixturesLoading } = useFixtures();

  if (fixturesLoading) {
    return (
      <div className="match-calendar">
        <h2>Upcoming matches</h2>
        <p className="cal-meta">Loading fixtures…</p>
      </div>
    );
  }

  if (fixtures.length === 0) {
    return (
      <div className="match-calendar">
        <h2>Upcoming matches</h2>
        <p className="cal-meta">No upcoming fixtures.</p>
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
