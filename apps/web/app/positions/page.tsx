"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market, type Position } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import { StatsPanel } from "@/components/StatsPanel";
import { PositionHistory } from "@/components/PositionHistory";
import { MatchPulse } from "@/components/MatchPulse";

function positionPayout(market: Market, position: Position): number {
  if (position.side === "yes") {
    const oppPool = market.noPool;
    const yourPool = market.yesPool;
    if (yourPool <= 0) return position.amountLamports;
    return position.amountLamports + Math.floor((position.amountLamports * oppPool) / yourPool);
  }
  const oppPool = market.yesPool;
  const yourPool = market.noPool;
  if (yourPool <= 0) return position.amountLamports;
  return position.amountLamports + Math.floor((position.amountLamports * oppPool) / yourPool);
}

function OpenPositionCard({ market, position }: { market: Market; position: Position }) {
  const odds = impliedProbability(market);
  const currentOdds = Math.round(odds[position.side] * 100);
  const potentialReturn = positionPayout(market, position);
  const isSettling = market.status === "awaiting_settlement";

  return (
    <div className={`open-position-card open-position-card--${market.status}`}>
      <div className="open-position-card-head">
        <span className={`returning-hero-side returning-hero-side--${position.side}`}>
          {position.side.toUpperCase()}
        </span>
        <div className="open-position-card-meta">
          <h2>{formatMarketQuestion(market.predicate)}</h2>
          <p>
            Match {market.predicate.matchId} · {market.status.replace("_", " ")}
            {isSettling && <span className="open-position-card-settling"> · settling</span>}
          </p>
        </div>
      </div>
      <div className="open-position-card-stats">
        <div>
          <span>Staked</span>
          <strong>{SOL(position.amountLamports)}</strong>
        </div>
        <div>
          <span>Odds</span>
          <strong>{currentOdds}%</strong>
        </div>
        <div>
          <span>Potential return</span>
          <strong>{SOL(potentialReturn)}</strong>
        </div>
      </div>
      <div className="open-position-card-actions">
        <Link href={`/markets/${market.id}`} className="setup-guide-cta">
          {isSettling ? "Awaiting result" : "Watch market"} <span>→</span>
        </Link>
        <Link href={`/match?match=${encodeURIComponent(String(market.predicate.matchId))}`} className="returning-hero-link">
          Match room
        </Link>
      </div>
    </div>
  );
}

export default function PositionsPage() {
  const { publicKey } = useWallet();
  const positions = useStoppageStore((s) => s.positions);
  const markets = useStoppageStore((s) => s.markets);

  const open = useMemo(() => {
    if (!publicKey) return [];
    const owner = publicKey.toBase58();
    return Object.values(positions)
      .filter((p) => {
        if (p.owner !== owner || p.amountLamports <= 0) return false;
        const m = markets[p.marketId];
        return m ? m.status === "open" || m.status === "awaiting_settlement" : true;
      })
      .map((p) => ({ position: p, market: markets[p.marketId] }))
      .filter((item): item is { position: Position; market: Market } => Boolean(item.market))
      .sort((a, b) => {
        // Open markets first, then by stake size
        const statusA = a.market.status === "open" ? 1 : 0;
        const statusB = b.market.status === "open" ? 1 : 0;
        if (statusA !== statusB) return statusB - statusA;
        return b.position.amountLamports - a.position.amountLamports;
      });
  }, [publicKey, positions, markets]);

  return (
    <main className="app-shell">
      <div className="market-explorer">
        <MatchPulse live={false} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--tape" />
        <div className="explorer-heading">
          <div>
            <p className="eyebrow">Positions</p>
            <h1>Your live calls.</h1>
            <p>Everything you have riding right now, in one place.</p>
          </div>
          <Link href="/markets" className="explorer-back">
            Markets <span>→</span>
          </Link>
        </div>

        <div className="positions-body">
          <div className="positions-list-col">
            {!publicKey ? (
              <div className="explorer-empty">
                <p>Connect your wallet</p>
                <p className="explorer-empty-hint">Sign in to see your open positions.</p>
              </div>
            ) : open.length === 0 ? (
              <div className="explorer-empty">
                <p>No live positions</p>
                <p className="explorer-empty-hint">
                  You don&apos;t have any open bets right now. Browse markets to place one.
                </p>
                <Link href="/markets" className="setup-guide-cta" style={{ marginTop: 18 }}>
                  Browse markets <span>→</span>
                </Link>
              </div>
            ) : (
              <div className="open-positions-grid">
                {open.map(({ market, position }) => (
                  <OpenPositionCard key={positionKey(position)} market={market} position={position} />
                ))}
              </div>
            )}
          </div>

          <aside className="positions-side-col">
            <StatsPanel />
            <PositionHistory />
          </aside>
        </div>
      </div>
    </main>
  );
}

function positionKey(p: Pick<Position, "marketId" | "owner">) {
  return `${p.marketId}:${p.owner}`;
}
