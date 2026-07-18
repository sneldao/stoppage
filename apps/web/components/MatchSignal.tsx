"use client";

import type { Market } from "@stoppage/sdk";

/** Aggregated pool balance for one match. It is context, not advice. */
export function MatchSignal({ markets }: { markets: Market[] }) {
  const openMarkets = markets.filter((market) => market.status === "open");
  const yesPool = openMarkets.reduce((total, market) => total + market.yesPool, 0);
  const noPool = openMarkets.reduce((total, market) => total + market.noPool, 0);
  const total = yesPool + noPool;

  if (openMarkets.length === 0 || total === 0) return null;

  const yesShare = Math.round((yesPool / total) * 100);
  return (
    <section className="match-signal" aria-label="Live call balance">
      <div><p className="eyebrow">Live call balance</p><h2>How this match is being read.</h2></div>
      <div className="match-signal-meter" aria-label={`${yesShare}% YES, ${100 - yesShare}% NO`}>
        <i style={{ width: `${yesShare}%` }} />
      </div>
      <div className="match-signal-values"><strong>YES {yesShare}%</strong><span>{openMarkets.length} live {openMarkets.length === 1 ? "call" : "calls"} · peer-funded signal, not advice</span><strong>NO {100 - yesShare}%</strong></div>
    </section>
  );
}
