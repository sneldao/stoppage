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

// ── Operator-attested (TheSportsDB) match context ───────────────────
// Markets created by the attestation keeper carry matchId "tsdb:<id>";
// they never resolve against the TxLINE fixture list. This renders the
// same context card from /api/tsdb-event, labeled honestly — operator
// attestation, not TxODDS verification (docs/ATTESTATION-ORACLE.md).

interface TsdbEvent {
  eventId: number;
  label: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: string;
  kickoffTs: number | null;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
}

function useTsdbEvent(eventId: number | null) {
  const [event, setEvent] = useState<TsdbEvent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (eventId === null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tsdb-event/${eventId}`);
        if (!res.ok) throw new Error(`tsdb-event ${res.status}`);
        const data = (await res.json()) as TsdbEvent;
        if (!cancelled) setEvent(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    // Refresh while the match could still be in progress — the final
    // score only appears here once TheSportsDB marks it finished.
    const id = window.setInterval(() => {
      if (!event?.finished) void load();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [eventId, event?.finished]);
  return { event, failed };
}

function TsdbMatchContext({ eventId }: { eventId: number }) {
  const { event, failed } = useTsdbEvent(eventId);
  const kickoff = event?.kickoffTs ? new Date(event.kickoffTs * 1000) : null;
  const started = kickoff !== null && kickoff.getTime() <= Date.now();
  const countdown = useCountdown(started ? null : kickoff);

  if (failed) {
    return (
      <section className="market-match-context market-match-context-warning" aria-label="Match context">
        Match data unavailable. Confirm the market condition before entering.
      </section>
    );
  }
  if (!event) {
    return (
      <section className="market-match-context market-match-context-loading" aria-label="Match context">
        <div className="mmc-skeleton" aria-hidden="true" />
      </section>
    );
  }

  return (
    <section
      className="market-match-context market-match-context-scheduled"
      aria-label="Match context"
    >
      <div className="market-match-context-top">
        <span>{event.league}</span>
        <strong className="mmc-status">
          {event.finished ? "Full-time" : started ? "In play" : countdown ? `⏱ ${countdown}` : "Fixture"}
        </strong>
      </div>

      <div className="market-match-context-score">
        <span className="mmc-team">{event.homeTeam}</span>
        <b className="mmc-score">
          {event.finished && event.homeGoals != null && event.awayGoals != null
            ? `${event.homeGoals}—${event.awayGoals}`
            : "vs"}
        </b>
        <span className="mmc-team">{event.awayTeam}</span>
      </div>

      <div className="market-match-context-stats">
        <span className="mmc-ts">TheSportsDB · operator-attested settlement</span>
      </div>
    </section>
  );
}

export function MarketMatchContext({ matchId, onSnapshot }: { matchId: string | number; onSnapshot?: (snapshot: LiveMatchSnapshot | null) => void }) {
  const tsdbId = String(matchId).startsWith("tsdb:")
    ? Number(String(matchId).slice(5))
    : null;
  if (tsdbId !== null && Number.isInteger(tsdbId)) {
    return <TsdbMatchContext eventId={tsdbId} />;
  }
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
