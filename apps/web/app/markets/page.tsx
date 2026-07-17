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

const SOL = (lamports: number) => `${(lamports / 1e9).toFixed(3)} SOL`;
const PREDICATE_LABEL: Record<string, string> = {
  next_goal_within: "Next goal within",
  corners_over: "Corners over",
  card_shown: "Card shown",
  total_goals_over: "Total goals over",
};

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
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20 hover:bg-white/[0.04]">
      <Link href={`/markets/${market.id}`} className="block">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {PREDICATE_LABEL[pred.kind] ?? pred.kind} {param}{team}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              match {pred.matchId} · pool {SOL(total)}
            </p>
          </div>
          <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${statusBadge(market.status)}`}>
            {market.status.replace("_", " ")}
          </span>
        </div>
        {market.status === "open" && (
          <div className="mt-3 flex items-center gap-4 text-sm">
            <span className="text-emerald-400">YES {(odds.yes * 100).toFixed(0)}%</span>
            <span className="text-neutral-600">|</span>
            <span className="text-red-400">NO {(odds.no * 100).toFixed(0)}%</span>
            <span className="ml-auto text-xs text-neutral-600">
              {market.verifications > 0 && `${market.verifications} ✓`}
            </span>
          </div>
        )}
      </Link>
      {market.status === "open" && (
        <div className="mt-2 flex justify-end">
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
          <p className="text-sm text-neutral-500">
            In-play micro-markets · peer-funded vaults · verifiable settlement
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-neutral-500">
          <p>No markets yet.</p>
          <p className="mt-1 text-xs">
            Markets appear here once created on-chain. Run the M2 acceptance
            flow or create one from the session-key demo.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((m) => (
            <MarketRow key={m.id} market={m} />
          ))}
        </div>
      )}

      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← back to session-key demo
      </Link>
    </main>
  );
}
