"use client";

import { useEffect, useMemo, useState } from "react";
import { countryFlag } from "@/lib/format";
import { isFixtureLive } from "@/lib/match/fixtures";
import { useFixtures, useFixtureScore } from "@/lib/match/useFixtures";
import { snapshotIsFresh } from "@/lib/match/types";
import type { LiveMatchSnapshot } from "@/lib/match/types";
import { safeStartTime, useCountdown } from "@/lib/time/useCountdown";

function asMilliseconds(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1_000 : ts;
}

export function MarketMatchContext({ matchId, onSnapshot }: { matchId: string | number; onSnapshot?: (snapshot: LiveMatchSnapshot | null) => void }) {
  const { fixtures, fixturesLoading } = useFixtures();
  const [scoreFlash, setScoreFlash] = useState(0);
  const prevScore = useMemo(() => ({ home: -1, away: -1 }), []);

  const fixture = useMemo(() => {
    const exact = fixtures.find((f) => f.matchId === String(matchId));
    if (exact) return exact;
    const byFixtureId = fixtures.find((f) => String(f.FixtureId) === String(matchId));
    if (byFixtureId) return byFixtureId;
    const lower = String(matchId).toLowerCase();
    return fixtures.find((f) =>
      f.matchId?.toLowerCase() === lower ||
      f.matchId?.toLowerCase().includes(lower) ||
      lower.includes(f.matchId?.toLowerCase() ?? "")
    ) ?? null;
  }, [fixtures, matchId]);

  const live = isFixtureLive(fixture);
  const snapshot = useFixtureScore(live && fixture ? fixture.FixtureId : null);
  const fresh = snapshotIsFresh(snapshot);

  const kickoff = fixture && !live ? safeStartTime(fixture) : null;
  const countdown = useCountdown(kickoff);

  useEffect(() => {
    if (!snapshot) {
      onSnapshot?.(null);
      return;
    }
    if (
      prevScore.home !== -1 &&
      (snapshot.score.home !== prevScore.home || snapshot.score.away !== prevScore.away)
    ) {
      setScoreFlash((v) => v + 1);
    }
    prevScore.home = snapshot.score.home;
    prevScore.away = snapshot.score.away;
    onSnapshot?.(snapshot);
  }, [snapshot, prevScore, onSnapshot]);

  if (fixturesLoading) {
    return (
      <section className="market-match-context market-match-context-loading" aria-label="Match context">
        <div className="mmc-skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (!fixture) {
    return (
      <section className="market-match-context market-match-context-warning" aria-label="Match context">
        Match data unavailable. Confirm the market condition before entering.
      </section>
    );
  }

  return (
    <section
      className={`market-match-context ${live && fresh ? "market-match-context-fresh" : live ? "market-match-context-warning" : "market-match-context-scheduled"}`}
      aria-label="Current match context"
    >
      <div className="market-match-context-top">
        <span>{countryFlag(fixture.Country)} {fixture.Country}</span>
        <strong className="mmc-status">
          {live ? (
            <>
              <i className="live-dot" style={{ width: 6, height: 6, marginRight: 5 }} />
              {fresh ? "Feed current" : "Feed delayed"}
            </>
          ) : countdown ? (
            <>⏱ {countdown}</>
          ) : "Fixture"}
        </strong>
      </div>

      <div className="market-match-context-score">
        <span className="mmc-team">{fixture.Participant1}</span>
        <b
          className={`mmc-score ${scoreFlash > 0 ? "score-flash" : ""}`}
          key={scoreFlash}
        >
          {live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}
        </b>
        <span className="mmc-team">{fixture.Participant2}</span>
      </div>

      {live && snapshot && (
        <div className="market-match-context-stats">
          <span>🚩 {snapshot.stats.corners} corners</span>
          <span>🟨 {snapshot.stats.cards} cards</span>
          {snapshot.updatedAt && (
            <span className="mmc-ts">
              {new Date(asMilliseconds(snapshot.updatedAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
