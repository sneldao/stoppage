"use client";

import { useStoppageStore } from "@/store";

const SOL = (lamports: number) => `${(lamports / 1e9).toFixed(3)} SOL`;

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
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-medium text-neutral-400">Bet history</h2>
      <div className="mt-3 space-y-2">
        {history.slice(0, 10).map((pos, i) => {
          const isWin = pos.outcome !== "void" && pos.side === pos.outcome;
          const pnl = pos.outcome === "void"
            ? 0
            : isWin
            ? pos.payoutLamports - pos.amountLamports
            : -pos.amountLamports;
          const pnlColor = pnl > 0 ? "text-emerald-400"
            : pnl < 0 ? "text-red-400" : "text-neutral-400";

          return (
            <div
              key={`${pos.marketId}-${pos.owner}-${i}`}
              className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{pos.label}</p>
                <p className="text-neutral-600">
                  {pos.side.toUpperCase()} · {pos.outcome.toUpperCase()}
                  {" · "}
                  {new Date(pos.settledAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`shrink-0 font-medium ${pnlColor}`}>
                {pnl >= 0 ? "+" : ""}{SOL(pnl)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
