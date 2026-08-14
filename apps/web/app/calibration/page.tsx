"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { CalibrationQuoteRow } from "@/components/CalibrationQuoteRow";
import { CalibrationScoreboard } from "@/components/CalibrationScoreboard";
import { ElectricBorder } from "@/components/ElectricBorder";
import { KeystoneBanner } from "@/components/KeystoneBanner";
import { useAllQuotes } from "@/lib/quotes/useAllQuotes";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";

/**
 * Calibration page — the public, verifiable "was the model right?" board.
 * Quotes vs on-chain receipts. No fabricated backtest numbers.
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

        <ElectricBorder variant="lime" speed={0.7} displacement={18} active>
          <ModelQuoteStrip quotes={quotes} streaming={streaming} hero />
        </ElectricBorder>

        <header className="page-head page-head--compact">
          <p className="eyebrow">Verifiable calibration</p>
          <h1>Was the model right?</h1>
          <p className="page-lede page-lede--short">
            Live quotes scored against on-chain receipts. No backtest fiction.
          </p>
        </header>

        <ol className="cal-steps" aria-label="How scoring works">
          <li><b>1</b> Quote</li>
          <li><b>2</b> Settle</li>
          <li><b>3</b> Score</li>
        </ol>
        <details className="disclose">
          <summary>How scoring works <i aria-hidden="true" /></summary>
          <div className="disclose__body">
            <p>
              Monte Carlo fair value, anchored to a TxLINE snapshot. Proof-gated
              settlement records the outcome. Brier score over those receipts —
              public, reproducible.
            </p>
          </div>
        </details>

        <CalibrationScoreboard />

        <section className="cal-board">
          <div className="cal-board-head">
            <h2>Live model lines</h2>
            <span className="cal-board-sub">
              {quotes.length > 0
                ? `${quotes.length} priced`
                : "awaiting first quote"}
            </span>
          </div>
          {quotes.length === 0 ? (
            <div className="cal-empty">
              <p className="cal-empty__lead">No live quote yet.</p>
              <p className="cal-empty__hint">
                {replayActive ? (
                  "Replay is running — lines should land shortly."
                ) : (
                  <>
                    <Link href="/#live-stage">Start a replay →</Link>
                    {" "}Matchkeeper publishes verifiable lines here.
                  </>
                )}
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
          <KeystoneBanner />
          <Link href="/operators" className="cal-cta-link">Operator API →</Link>
        </section>
      </div>
    </main>
  );
}
