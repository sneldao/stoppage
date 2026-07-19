"use client";

import { useEffect, useRef, useState } from "react";
import type { Market, Position } from "@stoppage/sdk";
import { formatSol as SOL } from "@/lib/format";
import { useCountUp } from "@/lib/anim/useCountUp";

/**
 * SettlementMoment — the climax of the loop, designed as an event.
 *
 * Watches market.status; when it transitions to settled/void, fires a
 * one-time overlay: outcome, your result, payout counting up, and a
 * "proof verified" line. Self-dismisses. Without this, settlement just
 * appears after a poll — the moment that matters most is the least
 * designed. The status transition is driven by the Helius monitor
 * pushing the settled market into the store.
 */

function proRataPayoutLamports(stake: number, yourPool: number, oppPool: number): number {
  if (yourPool <= 0) return stake;
  return stake + Math.floor((stake * oppPool) / yourPool);
}

export function SettlementMoment({ market, myPosition }: { market: Market; myPosition?: Position }) {
  const prevStatus = useRef(market.status);
  const [moment, setMoment] = useState<null | { kind: "settled" | "void"; outcome: string; won: boolean; payout: number }>(null);

  useEffect(() => {
    const prev = prevStatus.current;
    const settled = market.status === "settled" || market.status === "void";
    const wasSettled = prev === "settled" || prev === "void";
    if (!wasSettled && settled) {
      let payout = 0;
      let won = false;
      if (myPosition && myPosition.amountLamports > 0) {
        if (market.status === "void") {
          payout = myPosition.amountLamports;
          won = true;
        } else if (myPosition.side === market.outcome) {
          const yourPool = myPosition.side === "yes" ? market.yesPool : market.noPool;
          const oppPool = myPosition.side === "yes" ? market.noPool : market.yesPool;
          payout = proRataPayoutLamports(myPosition.amountLamports, yourPool, oppPool);
          won = true;
        }
      }
      setMoment({ kind: market.status === "void" ? "void" : "settled", outcome: market.outcome ?? "void", won, payout });
      const t = setTimeout(() => setMoment(null), 9_000);
      prevStatus.current = market.status;
      return () => clearTimeout(t);
    }
    prevStatus.current = market.status;
  }, [market.status, market.outcome, market.yesPool, market.noPool, myPosition]);

  const count = useCountUp(moment?.payout ?? 0, 1_200, Boolean(moment));
  if (!moment) return null;

  return (
    <div className={`settlement-moment settlement-moment--${moment.kind} ${moment.won ? "settlement-moment--won" : "settlement-moment--lost"}`} role="alert">
      <span className="settlement-moment-badge">{moment.kind === "void" ? "VOID" : "SETTLED"}</span>
      <h2>{moment.kind === "void" ? "Market voided · refunds" : `${moment.outcome.toUpperCase()} wins`}</h2>
      {myPosition && myPosition.amountLamports > 0 ? (
        moment.won ? (
          <p className="settlement-moment-result settlement-moment-result--won">
            You won <strong>{SOL(Math.round(count))}</strong>
          </p>
        ) : (
          <p className="settlement-moment-result settlement-moment-result--lost">This bet did not resolve your way</p>
        )
      ) : (
        <p className="settlement-moment-result settlement-moment-result--neutral">Result verified on-chain</p>
      )}
      <a className="settlement-moment-proof" href={`https://explorer.solana.com/address/${market.id}?cluster=devnet`} target="_blank" rel="noreferrer">
        ✓ Proof path verified · view market ↗
      </a>
    </div>
  );
}
