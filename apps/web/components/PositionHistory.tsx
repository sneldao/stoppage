"use client";

import { useStoppageStore } from "@/store";
import { formatSol as SOL } from "@/lib/format";

/**
 * Position history — shows the user's settled bet history.
 *
 * Reads from the history slice (localStorage-backed). Each entry shows
 * the market label, side, outcome, and PnL.
 */
export function PositionHistory() {
  const history = useStoppageStore((s) => s.history);

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="position-history">
      <h2>Bet history</h2>
      <div>
        {history.slice(0, 10).map((pos, i) => {
          const isWin = pos.outcome !== "void" && pos.side === pos.outcome;
          const pnl = pos.outcome === "void"
            ? 0
            : isWin
            ? pos.payoutLamports - pos.amountLamports
            : -pos.amountLamports;
          const pnlClass = pnl > 0 ? "ph-pnl-pos"
            : pnl < 0 ? "ph-pnl-neg" : "";

          return (
            <div
              key={`${pos.marketId}-${pos.owner}-${i}`}
              className="ph-entry"
            >
              <div className="min-w-0">
                <p className="ph-label">{pos.label}</p>
                <p className="ph-meta">
                  {pos.side.toUpperCase()} · {pos.outcome.toUpperCase()}
                  {" · "}
                  {new Date(pos.settledAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`shrink-0 ${pnlClass}`}>
                {pnl >= 0 ? "+" : ""}{SOL(pnl)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
