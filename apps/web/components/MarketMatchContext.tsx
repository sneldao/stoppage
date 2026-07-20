"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fixture } from "@stoppage/txline";
import { countryFlag } from "@/lib/format";
import { isFixtureLive } from "@/lib/match/fixtures";

type FixtureWithMatchId = Fixture & { matchId: string };

interface MatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

function asMilliseconds(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1_000 : ts;
}

function safeStartTime(fixture: Fixture): Date {
  const raw = fixture.StartTime as unknown;
  if (typeof raw === "number") return new Date(raw * 1000);
  if (typeof raw === "string") return new Date(raw);
  return new Date(0);
}

function useCountdown(target: Date | null): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setLabel("Now"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setLabel(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [target]);
  return label;
}

export function MarketMatchContext({ matchId, onSnapshot }: { matchId: string | number; onSnapshot?: (snapshot: MatchSnapshot | null) => void }) {
  const [fixtures, setFixtures] = useState<FixtureWithMatchId[]>([]);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreFlash, setScoreFlash] = useState(0);
  const prevScore = useMemo(() => ({ home: -1, away: -1 }), []);

  const fixture = useMemo(() => {
    // Exact match first
    const exact = fixtures.find((f) => f.matchId === String(matchId));
    if (exact) return exact;
    // Fallback: matchId may be a FixtureId or partial match
    const byFixtureId = fixtures.find((f) => String(f.FixtureId) === String(matchId));
    if (byFixtureId) return byFixtureId;
    // Fallback: case-insensitive or substring match
    const lower = String(matchId).toLowerCase();
    return fixtures.find((f) =>
      f.matchId?.toLowerCase() === lower ||
      f.matchId?.toLowerCase().includes(lower) ||
      lower.includes(f.matchId?.toLowerCase() ?? "")
    ) ?? null;
  }, [fixtures, matchId]);

  const live = isFixtureLive(fixture);
  const fresh = snapshot?.updatedAt
    ? Date.now() - asMilliseconds(snapshot.updatedAt) <= 45_000
    : false;

  const kickoff = fixture && !live ? safeStartTime(fixture) : null;
  const countdown = useCountdown(kickoff);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: { fixtures?: FixtureWithMatchId[] }) => {
        if (!cancelled) setFixtures(data.fixtures ?? []);
      })
      .catch(() => { if (!cancelled) setFixtures([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fixture || !live) { setSnapshot(null); onSnapshot?.(null); return; }
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/fixtures/${fixture.FixtureId}/score`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: MatchSnapshot) => {
          if (cancelled) return;
          // Flash on score change
          if (
            prevScore.home !== -1 &&
            (data.score.home !== prevScore.home || data.score.away !== prevScore.away)
          ) {
            setScoreFlash((v) => v + 1);
          }
          prevScore.home = data.score.home;
          prevScore.away = data.score.away;
          setSnapshot(data);
          onSnapshot?.(data);
        })
        .catch(() => { if (!cancelled) { setSnapshot(null); onSnapshot?.(null); } });
    };
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [fixture, live, prevScore, onSnapshot]);

  if (loading) {
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
