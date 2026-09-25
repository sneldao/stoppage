"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStoppageStore } from "@/store";
import { useCountdown } from "@/lib/time/useCountdown";
import {
  findWeekMarket,
  weekLineUsd,
  weekPhase,
  weekWindowFor,
} from "@/lib/campaign/settledWeek";

/**
 * WeekStrip — the Settled Week home strip.
 *
 * Surfaces this week's SOL/USD Pyth window: opens with the keeper's Friday
 * create, counts down to the Sunday 23:00 UTC close, then points at the
 * receipt — both this week's market page and the cumulative /receipts
 * track record. Markets are found on-chain by matchId, never hardcoded.
 */
export function WeekStrip() {
  const markets = useStoppageStore((s) => s.markets);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const win = weekWindowFor(now);
  const market = findWeekMarket(markets, win.matchId);
  const phase = weekPhase(now, market, win);
  const countdown = useCountdown(phase === "window_open" ? new Date(win.closeMs) : null);

  return (
    <div className="week-strip" aria-label="Settled Week window">
      {phase === "countdown" && (
        <span>
          <strong>Settled Week · {win.label}</strong> — this week&apos;s SOL/USD
          window opens on Friday, settles from a verified Pyth price Sunday 23:00 UTC.
        </span>
      )}
      {phase === "window_open" && market && (
        <span>
          <strong>SOL/USD {win.label}</strong>: above ${Math.round(weekLineUsd(market))} ·
          closes in {countdown || "…"} · settles by proof, no admin key
        </span>
      )}
      {phase === "awaiting_receipt" && (
        <span>
          <strong>Settled Week · {win.label}</strong> — window closed, the Pyth receipt
          settles in the same transaction that releases the funds.
        </span>
      )}
      {phase === "receipt" && market && (
        <span>
          <strong>{win.label} settled {market.outcome.toUpperCase()} by proof</strong> ·
          Pyth price verified on-chain · 0 admin keys
        </span>
      )}
      {market ? (
        <Link href={`/markets/${market.id}${phase === "receipt" ? "#proof" : ""}`}>
          {phase === "window_open" ? "Back the call →" : "View the receipt →"}
        </Link>
      ) : (
        <Link href="/receipts">How settlement works →</Link>
      )}
      <Link href="/receipts" className="week-strip__track">Track record →</Link>
    </div>
  );
}
