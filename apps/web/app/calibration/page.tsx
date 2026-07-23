"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { CalibrationQuoteRow } from "@/components/CalibrationQuoteRow";
import { CalibrationScoreboard } from "@/components/CalibrationScoreboard";
import { useAllQuotes } from "@/lib/quotes/useAllQuotes";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";

/**
 * Calibration page — the public, verifiable "was the model right?" board.
 *
 * The leaderboard populates from settled markets as they resolve.
 * Until history accrues, the live model lines feed the board. No fabricated backtest numbers.
 */

export default function CalibrationPage() {
  useMarkets();
  const { quotes, streaming } = useAllQuotes();
  const replayActive = useStoppageStore((s) => Boolean(s.replayStatus?.active));

  return (
    <main className="page-shell calibration-page">
      <div className="page-shell-content">
        <div className="cal-grooves" aria-hidden="true">
          <SpinningGrooves size={360} rings={5} color="var(--blue)" counterRotate speed={0.5} />
        </div>

        <ModelQuoteStrip quotes={quotes} streaming={streaming} hero />

        <header className="page-head page-head--compact">
          <p className="eyebrow">Verifiable calibration</p>
          <h1>Was the model right?</h1>
          <p className="page-lede page-lede--short">
            Every quote is anchored to a Merkle-proven TxLINE snapshot and a published model.
            Settled markets are scored against on-chain receipts — auditable, not a black box.
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

        <CalibrationScoreboard />

        <section className="cal-board">
          <div className="cal-board-head">
            <h2>Live model lines</h2>
            <span className="cal-board-sub">
              {quotes.length > 0
                ? `${quotes.length} market${quotes.length !== 1 ? "s" : ""} priced`
                : "feeding the calibration curve"}
            </span>
          </div>
          {quotes.length === 0 ? (
            <div className="cal-empty">
              <p className="cal-empty__lead">Waiting for the first live quote.</p>
              <p className="cal-empty__hint">
                {replayActive
                  ? "Replay is running — Matchkeeper should publish lines shortly."
                  : "Start a match replay and Matchkeeper will publish verifiable lines here."}
                {" "}Settled markets will populate the Brier leaderboard as they resolve.
              </p>
            </div>
          ) : (
            <div className="cal-table">
              <div className="cal-row cal-row--head">
                <span>Market</span>
                <span>Trend</span>
                <span>Fair</span>
                <span>Bid–ask</span>
                <span>CI</span>
                <span>Model</span>
                <span />
              </div>
              {quotes.map((q) => (
                <CalibrationQuoteRow key={q.marketId} quote={q} />
              ))}
            </div>
          )}
        </section>

        <section className="cal-cta">
          <p>Building an agent, a sportsbook, or a prediction market? License the verifiable pricing + settlement layer.</p>
          <Link href="/operators" className="cal-cta-link">See the operator API →</Link>
        </section>
      </div>
    </main>
  );
}
