"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { impliedProbability } from "@stoppage/sdk";
import type { Market } from "@stoppage/sdk";
import { buildMarketTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";
import { StatsPanel } from "@/components/StatsPanel";
import { PositionHistory } from "@/components/PositionHistory";
import { MatchCalendar } from "@/components/MatchCalendar";
import { formatSol as SOL } from "@/lib/format";
import { PREDICATE_LABEL } from "@stoppage/sdk";
import { ProofBoard } from "@/components/ProofBoard";

const tapeFilters = [
  { id: "all", label: "All" },
  { id: "open", label: "Live" },
  { id: "awaiting_settlement", label: "Settling" },
  { id: "settled", label: "Resolved" },
] as const;

type TapeFilter = (typeof tapeFilters)[number]["id"];

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

  const refTag = publicKey?.toBase58() ?? referrer ?? undefined;
  const pageUrl = typeof window !== "undefined"
    ? `${window.location.origin}/markets/${market.id}`
    : `/markets/${market.id}`;
  const tweetIntent = buildTweetIntent(
    buildMarketTweet(market, pageUrl, refTag)
  );

  return (
    <div className="explorer-market">
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
            {market.status.replace("_", " ")}
          </span>
        </div>
        {market.status === "open" && (
          <div className="explorer-odds">
            <span>YES <strong>{(odds.yes * 100).toFixed(0)}%</strong></span>
            <span className="explorer-odds-track"><i style={{ width: `${odds.yes * 100}%` }} /></span>
            <span>NO <strong>{(odds.no * 100).toFixed(0)}%</strong></span>
            <span className="explorer-live"><i /> LIVE</span>
          </div>
        )}
      </Link>
      {market.status === "open" && (
        <div className="explorer-share">
          <a
            href={tweetIntent}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => recordShare()}
          >
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

  const sorted = useMemo(() => {
    const order: Record<Market["status"], number> = {
      open: 0,
      awaiting_settlement: 1,
      settled: 2,
      void: 3,
    };
    return Object.values(markets).sort(
      (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
    );
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
      <div className="explorer-heading">
        <div>
          <p className="eyebrow">Markets</p>
          <h1>Every bet in play.</h1>
          <p>Peer-funded positions with outcomes locked to the TxLINE proof path.</p>
        </div>
        <button
          onClick={() => void refresh()}
          className="explorer-refresh"
        >
          Refresh
        </button>
      </div>

      <div className="explorer-context">
        <StatsPanel />
        <ProofBoard markets={sorted} />
      </div>

      <div className="tape-controls" aria-label="Market state filters">
        <div><p className="eyebrow">Filter by match</p><span>{visible.length} visible</span></div>
        <div className="tape-filter-list">{tapeFilters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      </div>

      {visible.length === 0 ? (
        <div className="explorer-empty">
          <p>{sorted.length === 0 ? "No markets yet." : "No matching markets."}</p>
          <p className="explorer-empty-hint">
            {sorted.length === 0 ? "Markets appear here when Matchkeeper publishes an eligible read." : "Try another market state to return to the full tape."}
          </p>
        </div>
      ) : (
        <div className="explorer-list">
          {byMatch.map(([matchId, matchMarkets]) => (
            <section className="tape-match-group" key={matchId} aria-label={`Match ${matchId} markets`}>
              <div className="tape-match-heading"><span>Match {matchId}</span><small>{matchMarkets.length} {matchMarkets.length === 1 ? "read" : "reads"}</small></div>
              {matchMarkets.map((market) => <MarketRow key={market.id} market={market} />)}
            </section>
          ))}
        </div>
      )}

      {/* Calendar is personal planning, separate from public proof state. */}
      <div className="explorer-sidecars">
        <MatchCalendar />
      </div>
      <PositionHistory />

      </div>
    </main>
  );
}
