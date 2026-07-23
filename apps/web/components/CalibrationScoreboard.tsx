"use client";

import Link from "next/link";
import { CalibrationCurve } from "@/components/CalibrationCurve";
import { useCalibration } from "@/lib/calibration/useCalibration";

export function CalibrationScoreboard() {
  const { data, loading, error } = useCalibration();

  if (loading && !data) {
    return (
      <section className="cal-scoreboard cal-scoreboard--loading" aria-label="Settled calibration">
        <div className="cal-scoreboard-head">
          <h2>Settled calibration</h2>
          <span className="cal-board-sub">Scoring resolved markets…</span>
        </div>
        <div className="cal-empty">
          <p className="cal-empty__lead">Loading on-chain outcomes…</p>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="cal-scoreboard" aria-label="Settled calibration">
        <div className="cal-scoreboard-head">
          <h2>Settled calibration</h2>
        </div>
        <div className="cal-empty">
          <p className="cal-empty__lead">{error}</p>
        </div>
      </section>
    );
  }

  if (!data || data.scoredCount === 0) {
    return (
      <section className="cal-scoreboard" aria-label="Settled calibration">
        <div className="cal-scoreboard-head">
          <h2>Settled calibration</h2>
          <span className="cal-board-sub">
            {data?.settledCount
              ? `${data.settledCount} settled · none scored yet`
              : "awaiting first settlement"}
          </span>
        </div>
        <div className="cal-empty">
          <p className="cal-empty__lead">No scored settlements yet.</p>
          <p className="cal-empty__hint">
            {data?.settledCount
              ? `${data.settledCount} market${data.settledCount !== 1 ? "s" : ""} settled on-chain but ${data.skippedNoQuote} lack a pricing receipt or agent quote to score against.`
              : "When markets settle through the proof path, quoted fair values will be compared to outcomes here — no fabricated backtest."}
            {" "}Primary score uses on-chain PricingReceipt; agent quote is the fallback.
          </p>
        </div>
      </section>
    );
  }

  const { report, rows, settledCount, scoredCount, skippedNoQuote } = data;
  // Brier score is on [0,1]: 0 = perfect, 0.25 = no-skill (coin flip).
  // Keep headline + table on the same scale so readers can verify:
  // mean(brierContribution) === report.brier.
  const brierStr = report.brier.toFixed(3);

  return (
    <section className="cal-scoreboard" aria-label="Settled calibration">
      <div className="cal-scoreboard-head">
        <h2>Settled calibration</h2>
        <span className="cal-board-sub">
          {scoredCount} scored · {settledCount} settled
          {skippedNoQuote > 0 ? ` · ${skippedNoQuote} skipped (no quote)` : ""}
        </span>
      </div>

      <div className="cal-scoreboard-stats">
        <div className="cal-stat">
          <span className="cal-stat__value">{brierStr}</span>
          <span className="cal-stat__label">Brier score</span>
          <small>0 = perfect · 0.25 = coin flip</small>
        </div>
        <div className="cal-stat">
          <span className="cal-stat__value">N={report.n}</span>
          <span className="cal-stat__label">Markets scored</span>
          <small>Proof-gated settlements only</small>
        </div>
        <CalibrationCurve buckets={report.buckets} />
      </div>

      <div className="cal-settled-table">
        <div className="cal-settled-row cal-settled-row--head">
          <span>Market</span>
          <span>Quoted</span>
          <span>Outcome</span>
          <span>Source</span>
          <span>Brier</span>
        </div>
        {rows.map((row) => (
          <div className="cal-settled-row" key={row.marketId}>
            <Link href={`/markets/${row.marketId}`} className="cal-market-link">
              {row.label}
            </Link>
            <strong>{Math.round(row.predicted * 100)}¢</strong>
            <span className={row.outcome === "yes" ? "cal-outcome-yes" : "cal-outcome-no"}>
              {row.outcome.toUpperCase()}
            </span>
            <span className="cal-source">
              {row.source === "receipt" ? "On-chain receipt" : "Agent quote"}
              {row.modelVersion ? ` · ${row.modelVersion}` : ""}
            </span>
            <span className="cal-brier-contrib">{row.brierContribution.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
