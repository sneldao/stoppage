"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useStoppageStore } from "@/store";
import { computeHistoryStats } from "@/store/historySlice";
import type { SettledPosition } from "@/store/historySlice";
import { formatSol as SOL } from "@/lib/format";
import { useSnsName } from "@/lib/wallet/useSnsName";

/**
 * Position history — shows the user's settled bet history with:
 * - SNS .sol domain resolution per entry
 * - W/L stats header and net PnL
 * - Hot streak callout when currentStreak >= 3
 * - Signing speed annotation on session-key bets
 */

/** One row — isolated component so each row can call useSnsName */
function HistoryRow({ pos, index }: { pos: SettledPosition; index: number }) {
  const snsName = useSnsName(pos.owner);
  const isWin = pos.outcome !== "void" && pos.side === pos.outcome;
  const pnl = pos.outcome === "void"
    ? 0
    : isWin
    ? pos.payoutLamports - pos.amountLamports
    : -pos.amountLamports;
  const pnlClass = pnl > 0 ? "ph-pnl-pos" : pnl < 0 ? "ph-pnl-neg" : "";
  const streakIcon = isWin ? "🔥" : pos.outcome === "void" ? "〰️" : "";

  return (
    <div
      key={`${pos.marketId}-${pos.owner}-${index}`}
      className={`ph-entry ${isWin ? "ph-entry-win" : pos.outcome === "void" ? "" : "ph-entry-loss"}`}
    >
      <div className="min-w-0">
        <p className="ph-label">
          {streakIcon && <span className="ph-streak-icon" aria-hidden="true">{streakIcon}</span>}
          {pos.label}
        </p>
        <p className="ph-meta">
          {snsName && <span className="ph-owner" title={pos.owner}>{snsName}</span>}
          {snsName && " · "}
          {pos.side.toUpperCase()} · {pos.outcome.toUpperCase()}
          {" · "}
          {new Date(pos.settledAt).toLocaleDateString()}
          {pos.signingMs !== undefined && (
            <span className="ph-speed"> · ⚡ {Math.round(pos.signingMs)}ms</span>
          )}
        </p>
      </div>
      <span className={`shrink-0 ${pnlClass}`}>
        {pnl >= 0 ? "+" : ""}{SOL(pnl)}
      </span>
    </div>
  );
}

export function PositionHistory() {
  const history = useStoppageStore((s) => s.history);
  const stats = useMemo(() => computeHistoryStats(history), [history]);
  const isHotStreak = stats.currentStreak >= 3;

  if (history.length === 0) {
    return (
      <div className="position-history position-history--empty">
        <h2>Bet history</h2>
        <p>Settled bets, W/L, and net PnL show up here after your first market closes.</p>
        <Link href="/markets" className="position-history-cta">Browse live markets →</Link>
      </div>
    );
  }

  return (
    <div className="position-history">
      <div className="ph-header">
        <h2>Bet history</h2>
        <div className="ph-header-right">
          {isHotStreak && (
            <div className="ph-hot-streak">
              <span className="ph-flame" aria-hidden="true">🔥🔥</span>
              <span className="ph-streak-label">{stats.currentStreak} win streak</span>
            </div>
          )}
          <div className="ph-stats">
            <span>{stats.wins}W · {stats.losses}L</span>
            <span className={stats.totalPnlLamports >= 0 ? "ph-pnl-pos" : "ph-pnl-neg"}>
              {stats.totalPnlLamports >= 0 ? "+" : ""}{SOL(stats.totalPnlLamports)} net
            </span>
          </div>
        </div>
      </div>
      <div>
        {history.slice(0, 10).map((pos, i) => (
          <HistoryRow key={`${pos.marketId}-${pos.owner}-${i}`} pos={pos} index={i} />
        ))}
      </div>
    </div>
  );
}
