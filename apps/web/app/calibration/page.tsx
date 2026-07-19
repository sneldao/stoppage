"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PricingSnapshot } from "@stoppage/sdk";

/**
 * Calibration page — the public, verifiable "was the model right?" board.
 *
 * This is the social/competitive hook that ONLY works because predictions are
 * on-chain and provable: every quoted probability is anchored to a TxLINE
 * snapshot + a published model, and every settlement outcome is proof-gated.
 * So a Brier score / calibration curve over settled markets is auditable by
 * anyone — web2 can't offer that because their model is proprietary.
 *
 * The leaderboard populates from settled markets (Person 2's attested
 * pricing + settlement). Until history accrues, it shows the methodology and
 * the live model lines feeding it. No fabricated backtest numbers.
 */

interface QuotePayload {
  marketId: string;
  label: string;
  predicateKind: string;
  snapshot: PricingSnapshot;
  result: { fairValue: number; bid: number; ask: number; ci: [number, number]; sims: number; modelVersion: string };
  inventorySkew: number;
  ts: number;
}

export default function CalibrationPage() {
  const [quotes, setQuotes] = useState<QuotePayload[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/quotes")
      .then((r) => r.json())
      .then((d: { quotes?: QuotePayload[] }) => { if (!cancelled && d.quotes) setQuotes(d.quotes); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="page-shell calibration-page">
      <header className="page-head">
        <p className="eyebrow">Verifiable calibration</p>
        <h1>Was the model right?</h1>
        <p className="page-lede">
          Every Matchkeeper quote is anchored to a Merkle-proven TxLINE snapshot and a
          published, open-source model. Every settlement is proof-gated on-chain. That
          means the model&apos;s quoted probabilities can be checked against reality — a
          Brier score and calibration curve anyone can audit. A web2 book can&apos;t offer
          this: their edge is the black box.
        </p>
      </header>

      <section className="cal-method">
        <div className="cal-method-card">
          <span className="cal-method-num">1</span>
          <div>
            <h3>Quote</h3>
            <p>Monte Carlo fair value + bid/ask, published live and anchored to the exact match snapshot.</p>
          </div>
        </div>
        <div className="cal-method-card">
          <span className="cal-method-num">2</span>
          <div>
            <h3>Settle</h3>
            <p>Proof-gated resolution records the true outcome on-chain — no operator discretion.</p>
          </div>
        </div>
        <div className="cal-method-card">
          <span className="cal-method-num">3</span>
          <div>
            <h3>Score</h3>
            <p>Brier score + calibration curve over all settled markets. Public, reproducible, trustless.</p>
          </div>
        </div>
      </section>

      <section className="cal-board">
        <div className="cal-board-head">
          <h2>Live model lines</h2>
          <span className="cal-board-sub">feeding the calibration curve</span>
        </div>
        {quotes.length === 0 ? (
          <p className="cal-empty">
            No live quotes yet — start a match replay and Matchkeeper will publish verifiable
            lines here. Settled markets will populate the Brier leaderboard as they resolve.
          </p>
        ) : (
          <div className="cal-table">
            <div className="cal-row cal-row--head">
              <span>Market</span>
              <span>Fair value</span>
              <span>CI</span>
              <span>Model</span>
            </div>
            {quotes.map((q) => (
              <div className="cal-row" key={q.marketId}>
                <span className="cal-market">{q.label}</span>
                <strong>{Math.round(q.result.fairValue * 100)}¢</strong>
                <span>±{Math.round(((q.result.ci[1] - q.result.ci[0]) / 2) * 100)}¢</span>
                <span className="cal-model">{q.result.modelVersion}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cal-cta">
        <p>Building an agent, a sportsbook, or a prediction market? License the verifiable pricing + settlement layer.</p>
        <Link href="/operators" className="cal-cta-link">See the operator API →</Link>
      </section>
    </main>
  );
}
