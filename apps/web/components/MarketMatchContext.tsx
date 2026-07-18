"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fixture } from "@stoppage/txline";
import { countryFlag } from "@/lib/format";

type FixtureWithMatchId = Fixture & { matchId: string };

interface MatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

function asMilliseconds(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
}

export function MarketMatchContext({ matchId }: { matchId: string | number }) {
  const [fixtures, setFixtures] = useState<FixtureWithMatchId[]>([]);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fixture = useMemo(
    () => fixtures.find((item) => item.matchId === String(matchId)) ?? null,
    [fixtures, matchId]
  );
  const fresh = snapshot?.updatedAt
    ? Date.now() - asMilliseconds(snapshot.updatedAt) <= 45_000
    : false;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Fixture feed unavailable")))
      .then((data: { fixtures?: FixtureWithMatchId[] }) => {
        if (!cancelled) setFixtures(data.fixtures ?? []);
      })
      .catch(() => { if (!cancelled) setFixtures([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fixture || !isLive(fixture)) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/fixtures/${fixture.FixtureId}/score`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Score feed unavailable")))
        .then((data: MatchSnapshot) => { if (!cancelled) setSnapshot(data); })
        .catch(() => { if (!cancelled) setSnapshot(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [fixture]);

  if (loading) {
    return <section className="market-match-context market-match-context-loading" aria-label="Match context">Loading match context…</section>;
  }

  if (!fixture) {
    return <section className="market-match-context market-match-context-warning" aria-label="Match context">Match data is unavailable. Confirm the market condition before entering.</section>;
  }

  const live = isLive(fixture);
  const freshnessLabel = !live
    ? "Scheduled"
    : fresh
      ? `Live · updated ${new Date(asMilliseconds(snapshot!.updatedAt!)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : "Live data delayed";

  return (
    <section className={`market-match-context ${fresh ? "market-match-context-fresh" : "market-match-context-warning"}`} aria-label="Current match context">
      <div className="market-match-context-top">
        <span>{countryFlag(fixture.Country)} {fixture.Country}</span>
        <strong><i /> {freshnessLabel}</strong>
      </div>
      <div className="market-match-context-score">
        <span>{fixture.Participant1}</span>
        <b>{live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</b>
        <span>{fixture.Participant2}</span>
      </div>
      <div className="market-match-context-stats">
        <span>{snapshot ? `Corners ${snapshot.stats.corners}` : live ? "Score update pending" : new Date(fixture.StartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span>{snapshot ? `Cards ${snapshot.stats.cards}` : live ? "Do not rely on stale data" : "Market opens with the match"}</span>
      </div>
    </section>
  );
}
