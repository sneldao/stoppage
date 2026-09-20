"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCalibration } from "@/lib/calibration/useCalibration";
import { useStoppageStore } from "@/store";

interface ScoredRow {
  marketId: string;
  predicted: number;
  outcome: string;
}

/**
 * YouVsQuant — the season skill game, scored honestly. Head-to-head only
 * on markets with BOTH a quant quote row and one of your settled positions.
 * No backtest fiction, no invented matchups.
 */
export function YouVsQuant() {
  const { data } = useCalibration();
  const history = useStoppageStore((s) => s.history);

  const tally = useMemo(() => {
    const rows = (data?.rows ?? []) as ScoredRow[];
    if (rows.length === 0 || history.length === 0) return null;
    const mine = new Map(history.map((h) => [h.marketId, h]));
    let shared = 0;
    let you = 0;
    let quant = 0;
    for (const row of rows) {
      const pos = mine.get(row.marketId);
      if (!pos || pos.outcome === "void" || row.outcome === "void") continue;
      shared += 1;
      if (pos.side === row.outcome) you += 1;
      const quantCall = row.predicted >= 0.5 ? "yes" : "no";
      if (quantCall === row.outcome) quant += 1;
    }
    return shared === 0 ? null : { shared, you, quant };
  }, [data, history]);

  if (!tally) {
    if (history.length === 0) return null;
    return (
      <section className="you-vs-quant" aria-label="You versus the quant">
        <p className="eyebrow">You vs quant</p>
        <p className="you-vs-quant-empty">
          No shared markets yet — settle a call the model also priced to open the head-to-head.{" "}
          <Link href="/markets">Find a market →</Link>
        </p>
      </section>
    );
  }

  const leader = tally.you > tally.quant ? "You lead" : tally.quant > tally.you ? "Quant leads" : "Dead heat";
  return (
    <section className="you-vs-quant" aria-label="You versus the quant">
      <div className="section-heading">
        <div>
          <p className="eyebrow">You vs quant</p>
          <h2>{leader}.</h2>
        </div>
        <span>{tally.shared} shared {tally.shared === 1 ? "market" : "markets"}</span>
      </div>
      <div className="you-vs-quant-meter" aria-label={`You ${tally.you}, quant ${tally.quant}`}>
        <i style={{ transform: `scaleX(${tally.you / tally.shared})` }} />
        <b style={{ transform: `scaleX(${tally.quant / tally.shared})` }} />
      </div>
      <div className="you-vs-quant-values">
        <strong>You {tally.you}–{tally.shared - tally.you}</strong>
        <span>head-to-head on proof-gated settles</span>
        <strong>Quant {tally.quant}–{tally.shared - tally.quant}</strong>
      </div>
    </section>
  );
}
