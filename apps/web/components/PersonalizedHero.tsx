"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market, type Position } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import type { SettledPosition } from "@/store";
import { computeHistoryStats } from "@/store/historySlice";

type FixtureWithMatchId = Fixture & { matchId: string };

interface PersonalizedHeroProps {
  markets: Record<string, Market>;
  positions: Record<string, Position>;
  history: SettledPosition[];
  fixtures: FixtureWithMatchId[];
  primaryMarket: Market | null;
  primaryPosition: Position | null;
}

function fixtureForMatchId(fixtures: FixtureWithMatchId[], matchId: string | number) {
  return fixtures.find((f) => String(f.matchId) === String(matchId)) ?? null;
}

/** Personalized hero copy for returning users — surfaces their live call. */
export function PersonalizedHero({
  markets,
  positions,
  history,
  fixtures,
  primaryMarket,
  primaryPosition,
}: PersonalizedHeroProps) {
  const { publicKey } = useWallet();

  const returningState = useMemo(() => {
    if (!publicKey) return { kind: "anonymous" as const };

    const owner = publicKey.toBase58();
    const open = Object.values(positions).filter((p) => {
      if (p.owner !== owner || p.amountLamports <= 0) return false;
      const m = markets[p.marketId];
      return m ? m.status === "open" || m.status === "awaiting_settlement" : true;
    });

    if (open.length > 0) {
      const pos = primaryPosition ?? open[0];
      const market = primaryMarket ?? markets[pos.marketId] ?? null;
      return { kind: "open" as const, pos, market, count: open.length };
    }

    if (history.length > 0) {
      const last = history[0];
      const stats = computeHistoryStats(history);
      return { kind: "history" as const, last, stats };
    }

    return { kind: "empty" as const };
  }, [publicKey, positions, markets, history, primaryMarket, primaryPosition]);

  if (returningState.kind === "anonymous" || returningState.kind === "empty") {
    return null;
  }

  if (returningState.kind === "history") {
    const { last, stats } = returningState;
    const streakLabel = stats.currentStreak >= 3
      ? `${stats.currentStreak} win streak 🔥`
      : stats.currentStreak <= -3
      ? `${Math.abs(stats.currentStreak)} loss streak`
      : null;

    return (
      <div className="returning-hero">
        <p className="eyebrow">Welcome back</p>
        <h1>Your next call is waiting.</h1>
        <p className="lede">
          Last bet: {last.side.toUpperCase()} · {last.outcome === "void" ? "voided" : last.side === last.outcome ? "won" : "lost"} · {SOL(last.payoutLamports)}.
        </p>
        {streakLabel && <p className="returning-hero-streak">{streakLabel}</p>}
        <div className="returning-hero-actions">
          <Link href="/markets" className="setup-guide-cta">
            Find a new market <span>→</span>
          </Link>
          <Link href="/markets" className="returning-hero-link">
            Browse all markets
          </Link>
        </div>
      </div>
    );
  }

  const { pos, market, count } = returningState;
  const fixture = market ? fixtureForMatchId(fixtures, market.predicate.matchId) : null;
  const odds = market ? impliedProbability(market) : null;
  const currentOdds = odds ? Math.round(odds[pos.side] * 100) : null;
  const isSettling = market?.status === "awaiting_settlement";

  return (
    <div className="returning-hero">
      <p className="eyebrow">{count > 1 ? `${count} live calls` : "Your live call"}</p>
      <h1>{market ? formatMarketQuestion(market.predicate) : "Live market"}</h1>

      <div className="returning-hero-position-card">
        <span className={`returning-hero-side returning-hero-side--${pos.side}`}>
          {pos.side.toUpperCase()}
        </span>
        <div className="returning-hero-position-meta">
          <strong>{SOL(pos.amountLamports)} at stake</strong>
          {currentOdds !== null && (
            <span>{currentOdds}% implied probability</span>
          )}
          {isSettling && <span className="returning-hero-settling">Awaiting settlement</span>}
        </div>
      </div>

      {fixture && (
        <p className="returning-hero-fixture">
          {fixture.Participant1} v {fixture.Participant2}
          {fixture.Country && ` · ${fixture.Country}`}
        </p>
      )}

      <div className="returning-hero-actions">
        <Link
          href={`/markets/${pos.marketId}`}
          className="setup-guide-cta"
        >
          {isSettling ? "Watch settlement" : "Watch your call"} <span>→</span>
        </Link>
        <Link
          href={`/match?match=${encodeURIComponent(String(market?.predicate.matchId ?? ""))}`}
          className="returning-hero-link"
        >
          Open match room
        </Link>
      </div>
    </div>
  );
}

/** Selector hook helper — computes the primary open position for the current wallet. */
export function usePrimaryOpenPosition(
  markets: Record<string, Market>,
  positions: Record<string, Position>
) {
  const { publicKey } = useWallet();

  return useMemo(() => {
    if (!publicKey) return { market: null as Market | null, position: null as Position | null };

    const owner = publicKey.toBase58();
    const open = Object.values(positions).filter((p) => {
      if (p.owner !== owner || p.amountLamports <= 0) return false;
      const m = markets[p.marketId];
      return m ? m.status === "open" || m.status === "awaiting_settlement" : true;
    });

    if (open.length === 0) return { market: null, position: null };

    // Prefer an open market over one awaiting settlement, then the largest stake.
    const sorted = [...open].sort((a, b) => {
      const ma = markets[a.marketId];
      const mb = markets[b.marketId];
      const statusA = ma?.status === "open" ? 1 : 0;
      const statusB = mb?.status === "open" ? 1 : 0;
      if (statusA !== statusB) return statusB - statusA;
      return b.amountLamports - a.amountLamports;
    });

    const position = sorted[0];
    const market = markets[position.marketId] ?? null;
    return { market, position };
  }, [publicKey, markets, positions]);
}
