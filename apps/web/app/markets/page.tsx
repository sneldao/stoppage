"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { impliedProbability } from "@stoppage/sdk";
import type { Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { buildMarketTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";
import { StatsPanel } from "@/components/StatsPanel";
import { PositionHistory } from "@/components/PositionHistory";
import { MatchCalendar } from "@/components/MatchCalendar";
import { formatSol as SOL } from "@/lib/format";
import { PREDICATE_LABEL } from "@stoppage/sdk";
import { ProofBoard } from "@/components/ProofBoard";
import { MatchPulse } from "@/components/MatchPulse";

const tapeFilters = [
  { id: "all", label: "All" },
  { id: "open", label: "Live" },
  { id: "awaiting_settlement", label: "Settling" },
  { id: "settled", label: "Resolved" },
] as const;

type TapeFilter = (typeof tapeFilters)[number]["id"];
type FixtureWithMatchId = Fixture & { matchId: string };

function statusBadge(status: Market["status"]) {
  const map: Record<Market["status"], string> = {
    open: "status-open",
    awaiting_settlement: "status-settling",
    settled: "status-settled",
    void: "status-void",
  };
  return map[status] ?? map.open;
}

function MarketRow({ market }: { market: Market }) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((s) => s.recordShare);
  const referrer = useStoppageStore((s) => s.referrer);
  const odds = impliedProbability(market);
  const pred = market.predicate;
  const param = pred.params.windowSeconds ?? pred.params.threshold ?? "";
  const team = pred.params.team ? ` · ${pred.params.team}` : "";
  const total = market.yesPool + market.noPool;
  const isOpen = market.status === "open";

  const refTag = publicKey?.toBase58() ?? referrer ?? undefined;
  const pageUrl = typeof window !== "undefined"
    ? `${window.location.origin}/markets/${market.id}`
    : `/markets/${market.id}`;
  const tweetIntent = buildTweetIntent(buildMarketTweet(market, pageUrl, refTag));

  return (
    <div className={`explorer-market ${isOpen ? "explorer-market--open" : ""}`}>
      <Link href={`/markets/${market.id}`} className="block">
        <div className="explorer-market-head">
          <div className="min-w-0">
            <p className="explorer-market-title">
              {PREDICATE_LABEL[pred.kind] ?? pred.kind} {param}{team}
            </p>
            <p className="explorer-market-meta">
              match {pred.matchId} · pool {SOL(total)}
            </p>
          </div>
          <span className={`explorer-status ${statusBadge(market.status)}`}>
            {isOpen && <i className="live-dot" style={{ marginRight: 5, width: 6, height: 6 }} />}
            {market.status.replace("_", " ")}
          </span>
        </div>
        {isOpen && (
          <div className="explorer-odds">
            <span>YES <strong>{(odds.yes * 100).toFixed(0)}%</strong></span>
            <span className="explorer-odds-track">
              <i style={{ width: `${odds.yes * 100}%`, transition: "width 600ms cubic-bezier(.2,.75,.25,1)" }} />
            </span>
            <span>NO <strong>{(odds.no * 100).toFixed(0)}%</strong></span>
            <span className="explorer-live"><i className="live-dot" style={{ width: 5, height: 5 }} /> LIVE</span>
          </div>
        )}
        {market.status === "settled" && (
          <div className="explorer-settled-row">
            <span className={`explorer-outcome ${market.outcome === "yes" ? "outcome--yes" : "outcome--no"}`}>
              {market.outcome?.toUpperCase()} resolved
            </span>
            {market.verifications > 0 && (
              <span className="explorer-verified">✓ proof verified</span>
            )}
          </div>
        )}
      </Link>
      {isOpen && (
        <div className="explorer-share">
          <a href={tweetIntent} target="_blank" rel="noopener noreferrer" onClick={() => recordShare()}>
            Share on X →
          </a>
        </div>
      )}
    </div>
  );
}

export default function MarketsPage() {
  const { markets, refresh } = useMarkets();
  useMyPositions();
  useHeliusMonitor();
  const [filter, setFilter] = useState<TapeFilter>("all");
  const [fixtures, setFixtures] = useState<FixtureWithMatchId[]>([]);

  // Silent auto-refresh every 12 s — markets settle and open in real time
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Fixture feed unavailable")))
      .then((data: { fixtures?: FixtureWithMatchId[] }) => { if (!cancelled) setFixtures(data.fixtures ?? []); })
      .catch(() => { if (!cancelled) setFixtures([]); });
    return () => { cancelled = true; };
  }, []);

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

  const visible = useMemo(
    () => filter === "all" ? sorted : sorted.filter((market) => market.status === filter),
    [filter, sorted]
  );

  const byMatch = useMemo(() => {
    const groups = new Map<string, Market[]>();
    for (const market of visible) {
      const key = String(market.predicate.matchId);
      groups.set(key, [...(groups.get(key) ?? []), market]);
    }
    return [...groups.entries()];
  }, [visible]);

  return (
    <main className="app-shell">
      <div className="market-explorer">
        <MatchPulse live={false} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--tape" />
        <div className="explorer-heading">
          <div>
            <p className="eyebrow">Markets</p>
            <h1>Every bet in play.</h1>
            <p>Peer-funded positions with results verified automatically.</p>
          </div>
          <button onClick={() => void refresh()} className="explorer-refresh" aria-label="Refresh markets">
            Refresh
          </button>
        </div>

        <div className="tape-controls" aria-label="Market state filters">
          <div>
            <p className="eyebrow">Filter markets</p>
            <span>{visible.length} visible</span>
          </div>
          <div className="tape-filter-list">
            {tapeFilters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? "active" : ""}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Two-column layout: market list + proof sidebar */}
        <div className="tape-body">
          <div className="tape-list-col">
            {visible.length === 0 ? (
              <div className="explorer-empty">
                <p>{sorted.length === 0 ? "No markets yet." : "No matching markets."}</p>
                <p className="explorer-empty-hint">
                  {sorted.length === 0
                    ? "Markets appear when the next match supports them."
                    : "Try another filter to return to the full tape."}
                </p>
              </div>
            ) : (
              <div className="explorer-list">
                {byMatch.map(([matchId, matchMarkets]) => {
                  const fixture = fixtures.find((f) => f.matchId === matchId);
                  const label = fixture
                    ? `${fixture.Participant1} v ${fixture.Participant2}`
                    : `Match ${matchId}`;
                  return (
                    <section className="tape-match-group" key={matchId} aria-label={`${label} markets`}>
                      <div className="tape-match-heading">
                        <span>{label}</span>
                        <small>{matchMarkets.length} {matchMarkets.length === 1 ? "market" : "markets"}</small>
                      </div>
                      {matchMarkets.map((market) => <MarketRow key={market.id} market={market} />)}
                    </section>
                  );
                })}
              </div>
            )}
          </div>

          {/* Proof sidebar — public protocol facts, always visible */}
          <aside className="tape-proof-col">
            <ProofBoard markets={sorted} />
            <StatsPanel />
          </aside>
        </div>

        {/* Personal history — collapsed by default, out of judges' way */}
        <details className="tape-personal-details">
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
