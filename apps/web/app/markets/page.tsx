"use client";

import Link from "next/link";
import { useMemo } from "react";
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

function statusBadge(status: Market["status"]) {
  const map: Record<Market["status"], string> = {
    open: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    awaiting_settlement: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    settled: "text-neutral-400 border-neutral-500/30 bg-neutral-500/5",
    void: "text-red-400 border-red-500/30 bg-red-500/5",
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
            className="text-xs text-neutral-500 transition hover:text-neutral-300"
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

  return (
    <main className="app-shell">
      <div className="market-explorer">
      <div className="explorer-heading">
        <div>
          <p className="eyebrow">Market tape</p>
          <h1>Every read in play.</h1>
          <p>Peer-funded match positions with outcomes locked to the TxLINE proof path.</p>
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

      {sorted.length === 0 ? (
        <div className="explorer-empty">
          <p>No markets yet.</p>
          <p className="mt-1 text-xs">
            Markets appear here once created on-chain. Run the agent
            or create one from the session-key demo.
          </p>
        </div>
      ) : (
        <div className="explorer-list">
          {sorted.map((m) => (
            <MarketRow key={m.id} market={m} />
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
