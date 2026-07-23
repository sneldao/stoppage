"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { impliedProbability, type Market, PREDICATE_LABEL } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import { StatsPanel } from "@/components/StatsPanel";
import { PositionHistory } from "@/components/PositionHistory";
import { MatchCalendar } from "@/components/MatchCalendar";
import { formatSol as SOL } from "@/lib/format";
import { ProofBoard } from "@/components/ProofBoard";
import { MatchPulse } from "@/components/MatchPulse";
import { OpenPositionsBanner } from "@/components/OpenPositionsBanner";
import { MarketsEmptyState } from "@/components/MarketsEmptyState";
import { tapeFilters, type TapeFilter } from "@/lib/markets/tapeFilters";
import { isFixtureLive, fixtureStartTimeMs } from "@/lib/match/fixtures";
import { useFixtures } from "@/lib/match/useFixtures";
import type { FixtureWithMatchId } from "@/lib/match/types";

const SpinningGrooves = dynamic(
  () => import("@/components/SpinningGrooves").then((m) => m.SpinningGrooves),
  { ssr: false }
);

const INITIAL_GROUPS_SHOWN = 4;
const GROUPS_PER_PAGE = 4;

const STATUS_LABEL: Record<Market["status"], string> = {
  open: "Open",
  awaiting_settlement: "Settling",
  settled: "Resolved",
  void: "Void",
};

const STATUS_CLASS: Record<Market["status"], string> = {
  open: "market-tape-row__status--open",
  awaiting_settlement: "market-tape-row__status--settling",
  settled: "market-tape-row__status--resolved",
  void: "market-tape-row__status--void",
};

function formatFixtureTime(fixture: FixtureWithMatchId | undefined) {
  if (!fixture) return null;
  const ms = fixtureStartTimeMs(fixture);
  if (!ms) return null;
  const d = new Date(ms);
  const now = Date.now();
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay && d.getTime() > now) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (sameDay) return "Today";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MarketRow({ market }: { market: Market }) {
  const odds = impliedProbability(market);
  const pred = market.predicate;
  const param = pred.params.windowSeconds ?? pred.params.threshold ?? "";
  const team = pred.params.team ? ` · ${pred.params.team}` : "";
  const total = market.yesPool + market.noPool;
  const isOpen = market.status === "open";

  // Subtle background flash when odds or pool move between refreshes.
  const [flash, setFlash] = useState(false);
  const prevRef = useRef<{ yes: number; total: number } | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { yes: odds.yes, total };
    if (!prev || (prev.yes === odds.yes && prev.total === total)) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 800);
    return () => window.clearTimeout(t);
  }, [odds.yes, total]);

  return (
    <Link
      href={`/markets/${market.id}`}
      className={`market-tape-row ${isOpen ? "market-tape-row--open" : ""} ${flash ? "market-tape-row--flash" : ""}`}
    >
      <div className="market-tape-row__title">
        <span>
          {PREDICATE_LABEL[pred.kind] ?? pred.kind} {param}
          {team}
        </span>
        <small>pool {SOL(total)}</small>
      </div>

      <div className="market-tape-row__odds">
        {isOpen ? (
          <>
            <span className="market-tape-row__yes">{Math.round(odds.yes * 100)}% YES</span>
            <span className="market-tape-row__no">{Math.round(odds.no * 100)}% NO</span>
          </>
        ) : market.status === "settled" ? (
          <span className={`market-tape-row__outcome outcome--${market.outcome}`}>
            {market.outcome?.toUpperCase()} resolved
          </span>
        ) : (
          <span className={`market-tape-row__status ${STATUS_CLASS[market.status]}`}>
            {STATUS_LABEL[market.status]}
          </span>
        )}
      </div>

      <span className="market-tape-row__arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

function MatchGroup({
  matchId,
  markets,
  fixture,
  expanded,
  onToggle,
}: {
  matchId: string;
  markets: Market[];
  fixture: FixtureWithMatchId | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const live = isFixtureLive(fixture);
  const label = fixture
    ? `${fixture.Participant1} v ${fixture.Participant2}`
    : `Match ${matchId}`;
  const time = live ? null : formatFixtureTime(fixture);

  return (
    <section className={`tape-match-group ${live ? "tape-match-group--live" : ""}`}>
      <button
        type="button"
        className="tape-match-heading"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`match-group-${matchId}`}
      >
        <span className="tape-match-heading__title">
          {label}
          {live && (
            <em className="tape-match-live">
              <i className="live-dot" /> LIVE
            </em>
          )}
          {time && <small className="tape-match-heading__time">{time}</small>}
        </span>
        <span className="tape-match-heading__right">
          <small>
            {markets.length} {markets.length === 1 ? "market" : "markets"}
          </small>
          <span className="tape-match-heading__chevron" aria-hidden="true" />
        </span>
      </button>

      <div
        id={`match-group-${matchId}`}
        className={`tape-match-group__body ${expanded ? "tape-match-group__body--open" : ""}`}
      >
        <div className="tape-match-group__inner">
          {markets.map((market) => (
            <MarketRow key={market.id} market={market} />
          ))}
        </div>
      </div>
    </section>
  );
}

function buildDefaultExpanded(byMatch: [string, Market[]][], fixtures: Map<string, FixtureWithMatchId>) {
  const next = new Set<string>();
  let nonLiveCount = 0;
  for (const [matchId] of byMatch) {
    const fixture = fixtures.get(matchId);
    if (isFixtureLive(fixture)) {
      next.add(matchId);
    } else if (nonLiveCount < 3) {
      next.add(matchId);
      nonLiveCount += 1;
    }
  }
  return next;
}

export default function MarketsPage() {
  useMarkets();
  useMyPositions();
  const markets = useStoppageStore((s) => s.markets);
  const marketsLoading = useStoppageStore((s) => s.marketsLoading);
  const history = useStoppageStore((s) => s.history);
  const positions = useStoppageStore((s) => s.positions);
  const hasPersonalData = history.length > 0 || Object.keys(positions).length > 0;
  const [filter, setFilter] = useState<TapeFilter>("open");
  const { fixtures } = useFixtures();

  const sorted = useMemo(() => {
    const order: Record<Market["status"], number> = {
      open: 0,
      awaiting_settlement: 1,
      settled: 2,
      void: 3,
    };
    return Object.values(markets).sort((a, b) => {
      const statusOrder = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return statusOrder || a.closesAt.localeCompare(b.closesAt);
    });
  }, [markets]);

  const counts = useMemo(() => {
    const c: Record<TapeFilter, number> = {
      all: sorted.length,
      open: 0,
      awaiting_settlement: 0,
      settled: 0,
    };
    for (const m of sorted) {
      if (m.status === "open") c.open += 1;
      else if (m.status === "awaiting_settlement") c.awaiting_settlement += 1;
      else if (m.status === "settled") c.settled += 1;
    }
    return c;
  }, [sorted]);

  const byMatch = useMemo(() => {
    const groups = new Map<string, Market[]>();
    const list = filter === "all" ? sorted : sorted.filter((m) => m.status === filter);
    for (const market of list) {
      const key = String(market.predicate.matchId);
      groups.set(key, [...(groups.get(key) ?? []), market]);
    }
    return [...groups.entries()];
  }, [filter, sorted]);

  const fixtureByMatchId = useMemo(() => {
    const map = new Map<string, FixtureWithMatchId>();
    for (const f of fixtures) {
      if (f.matchId) map.set(f.matchId, f);
    }
    return map;
  }, [fixtures]);

  const hasLive = useMemo(() => fixtures.some((f) => isFixtureLive(f)), [fixtures]);

  const [expandedMatches, setExpandedMatches] = useState<Set<string>>(new Set());
  const [showMoreLimit, setShowMoreLimit] = useState(INITIAL_GROUPS_SHOWN);
  const filterRef = useRef(filter);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (filterRef.current !== filter) {
      filterRef.current = filter;
      setExpandedMatches(buildDefaultExpanded(byMatch, fixtureByMatchId));
      setShowMoreLimit(INITIAL_GROUPS_SHOWN);
      return;
    }
    if (!initializedRef.current && !marketsLoading && byMatch.length > 0) {
      initializedRef.current = true;
      setExpandedMatches(buildDefaultExpanded(byMatch, fixtureByMatchId));
    }
  }, [filter, byMatch, fixtureByMatchId, marketsLoading]);

  const visibleGroups = byMatch.slice(0, showMoreLimit);
  const hasMore = byMatch.length > showMoreLimit;

  const verifiedCount = useMemo(
    () => sorted.filter((m) => m.status === "settled" && m.verifications > 0).length,
    [sorted]
  );

  const handleShowMore = () => setShowMoreLimit((n) => Math.min(n + GROUPS_PER_PAGE, byMatch.length));

  return (
    <main className="app-shell">
      <div className="market-explorer markets-page">
        <MatchPulse live={hasLive} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--tape" />
        <div className="market-hero-grooves" aria-hidden="true">
          <SpinningGrooves size={420} rings={5} color="var(--lime)" counterRotate speed={0.6} />
        </div>

        <div className="markets-header">
          <div className="markets-header__copy">
            <p className="eyebrow">Markets</p>
            <h1>Find a match, pick a market.</h1>
          </div>
          <span className="markets-header__live" aria-live="polite">
            <i className={hasLive ? "live-dot" : "schedule-dot"} />
            {hasLive ? "Match in play · tape live" : "Tape updates live"}
          </span>
        </div>

        <div className="markets-toolbar">
          <div className="markets-filter-chips" role="tablist" aria-label="Market state filters">
            {tapeFilters.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? "active" : ""}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className="markets-filter-count">{counts[item.id]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <OpenPositionsBanner />

        <div className="tape-body">
          <div className="tape-list-col">
            {marketsLoading && sorted.length === 0 ? (
              <div className="explorer-skeleton" aria-label="Loading markets">
                {[0, 1, 2].map((i) => (
                  <div className="explorer-skeleton-row" key={i}>
                    <span className="skeleton-line skeleton-line--title" />
                    <span className="skeleton-line skeleton-line--meta" />
                    <span className="skeleton-line skeleton-line--bar" />
                  </div>
                ))}
              </div>
            ) : byMatch.length === 0 ? (
              <MarketsEmptyState
                filter={filter}
                hasAnyMarkets={sorted.length > 0}
                marketsLoading={marketsLoading}
                onSwitchFilter={setFilter}
              />
            ) : (
              <>
                <div className="explorer-list">
                  {visibleGroups.map(([matchId, matchMarkets]) => (
                    <MatchGroup
                      key={matchId}
                      matchId={matchId}
                      markets={matchMarkets}
                      fixture={fixtureByMatchId.get(matchId)}
                      expanded={expandedMatches.has(matchId)}
                      onToggle={() =>
                        setExpandedMatches((prev) => {
                          const next = new Set(prev);
                          if (next.has(matchId)) next.delete(matchId);
                          else next.add(matchId);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>

                {hasMore && (
                  <button
                    type="button"
                    className="markets-show-more"
                    onClick={handleShowMore}
                  >
                    Show {Math.min(GROUPS_PER_PAGE, byMatch.length - showMoreLimit)} more{" "}
                    {byMatch.length - showMoreLimit === 1 ? "match" : "matches"}
                  </button>
                )}
              </>
            )}
          </div>

          <aside className="tape-proof-col">
            <details className="tape-proof-details">
              <summary>
                <span className="tape-proof-summary__label">Verified on-chain</span>
                <span className="tape-proof-summary__count">{verifiedCount} proofs</span>
                <span className="tape-proof-summary__chevron" aria-hidden="true" />
              </summary>
              <div className="tape-proof-details__body">
                <ProofBoard markets={sorted} />
                <StatsPanel />
              </div>
            </details>
          </aside>
        </div>

        <details className="tape-personal-details" open={hasPersonalData}>
          <summary>My positions &amp; history</summary>
          <div className="tape-personal-body">
            <PositionHistory />
            <MatchCalendar />
          </div>
        </details>
      </div>
    </main>
  );
}
