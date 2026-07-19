"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";

/**
 * LivePnLStrip — your open positions, breathing with the market.
 *
 * Reads positions + markets from the store and recomputes pro-rata payout
 * on every odds tick (the Helius monitor pushes pool updates into the
 * store, so this is reactive without its own polling). Shown only when
 * you have a stake on an open market. Payout math mirrors claim() in
 * useMarketActions (pre-fee, pro-rata).
 */

function proRataPayoutLamports(stake: number, yourPool: number, oppPool: number): number {
  if (yourPool <= 0) return stake;
  return stake + Math.floor((stake * oppPool) / yourPool);
}

export function LivePnLStrip() {
  const { publicKey } = useWallet();
  const positions = useStoppageStore((s) => s.positions);
  const markets = useStoppageStore((s) => s.markets);

  if (!publicKey) return null;
  const owner = publicKey.toBase58();

  const open = Object.values(positions).filter((p) => {
    if (p.owner !== owner || p.amountLamports <= 0) return false;
    const m = markets[p.marketId];
    return m?.status === "open";
  });
  if (open.length === 0) return null;

  let totalAtRisk = 0;
  let totalIfAllWin = 0;
  const chips = open.map((p) => {
    const m = markets[p.marketId];
    const yourPool = p.side === "yes" ? m.yesPool : m.noPool;
    const oppPool = p.side === "yes" ? m.noPool : m.yesPool;
    const payout = proRataPayoutLamports(p.amountLamports, yourPool, oppPool);
    const odds = impliedProbability(m)[p.side];
    totalAtRisk += p.amountLamports;
    totalIfAllWin += payout;
    return { p, m, payout, odds };
  });

  const deltaPct = totalAtRisk > 0 ? ((totalIfAllWin - totalAtRisk) / totalAtRisk) * 100 : 0;
  const up = deltaPct >= 0;

  return (
    <div className="live-pnl-strip" role="status" aria-live="polite">
      <span className="live-pnl-label">
        <i className="live-dot" /> Your live positions
      </span>
      <span className={`live-pnl-total ${up ? "up" : "down"}`}>
        {SOL(totalAtRisk)} at risk · if all win: {SOL(totalIfAllWin)} ({up ? "+" : ""}{deltaPct.toFixed(0)}%)
      </span>
      <div className="live-pnl-chips">
        {chips.slice(0, 3).map(({ p, m, payout, odds }) => (
          <Link key={p.marketId} href={`/markets/${p.marketId}`} className="live-pnl-chip">
            <span className={`live-pnl-side live-pnl-side--${p.side}`}>{p.side.toUpperCase()}</span>
            <span className="live-pnl-q">{m ? formatMarketQuestion(m.predicate) : "…"}</span>
            <span className="live-pnl-now">if {p.side} wins <strong>{SOL(payout)}</strong></span>
            <span className="live-pnl-odds">{Math.round(odds * 100)}%</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
