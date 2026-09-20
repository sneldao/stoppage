"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { isFixtureLive } from "@/lib/match/fixtures";
import { safeStartTime, useCountdown } from "@/lib/time/useCountdown";

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function startMs(f: FixtureWithMatchId): number {
  const raw = f.StartTime as unknown;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  return Date.parse(raw as string);
}

function SlateRow({ fixture }: { fixture: FixtureWithMatchId }) {
  const live = isFixtureLive(fixture);
  const countdown = useCountdown(live ? null : safeStartTime(fixture));
  const start = new Date(startMs(fixture)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Link
      className={`slate-row ${live ? "slate-row--live" : ""}`}
      href={`/match?match=${encodeURIComponent(fixture.matchId)}`}
    >
      <span className="slate-time">{live ? "LIVE" : start}</span>
      <strong>{fixture.Participant1} v {fixture.Participant2}</strong>
      <span className="slate-meta">{fixture.Country ?? fixture.Competition ?? ""}</span>
      <span className="slate-count">{live ? "In play →" : countdown ? `${countdown} →` : "→"}</span>
    </Link>
  );
}

/**
 * MatchSlate — the matchday ritual in one screen: today's fixtures with
 * kickoff countdowns, live ones first. The retention loop for days like
 * today (five games across EPL + MLS).
 */
export function MatchSlate({ fixtures }: { fixtures: FixtureWithMatchId[] }) {
  const today = useMemo(() => {
    const now = Date.now();
    const day = utcDay(now);
    // Drop fixtures whose kickoff is long past unless live — TxLINE states
    // can lag, and a noon room must not list dawn games as NOW.
    const staleBefore = now - 3 * 3_600_000;
    return fixtures
      .filter((f) => {
        if (f.GameState === 6) return false;
        const t = startMs(f);
        if (!Number.isFinite(t) || t < staleBefore) return false;
        // Today (UTC) or currently live.
        return utcDay(t) === day || isFixtureLive(f);
      })
      .sort((a, b) => {
        const liveDiff = Number(isFixtureLive(b)) - Number(isFixtureLive(a));
        return liveDiff !== 0 ? liveDiff : startMs(a) - startMs(b);
      })
      .slice(0, 8);
  }, [fixtures]);

  if (today.length === 0) return null;

  return (
    <section className="match-slate" aria-label="Today's slate">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Today&apos;s slate</p>
          <h2>Every game. One screen.</h2>
        </div>
        <Link href="/match">Match room <span>→</span></Link>
      </div>
      <div className="slate-list">
        {today.map((f) => (
          <SlateRow key={f.FixtureId} fixture={f} />
        ))}
      </div>
    </section>
  );
}
