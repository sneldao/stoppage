"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStoppageStore, computeHistoryStats } from "@/store";
import { formatSol as SOL } from "@/lib/format";

/**
 * Stats panel — shows the user's betting history stats.
 *
 * Displays: total bets, wins/losses, PnL, current streak, best streak.
 * Reads from the history slice (localStorage-backed).
 */
export function StatsPanel() {
  const { publicKey } = useWallet();
  const history = useStoppageStore((s) => s.history);

  const stats = useMemo(() => computeHistoryStats(history), [history]);

  if (history.length === 0) {
    return (
      <div className="stats-panel">
        <h2>My form</h2>
        <p className="stats-volume">
          No settled positions on this device yet. Form is personal; public proof lives on the protocol board.
        </p>
      </div>
    );
  }

  const pnlColor = stats.totalPnlLamports > 0 ? "stats-pnl-pos"
    : stats.totalPnlLamports < 0 ? "stats-pnl-neg" : "";

  const streakLabel = stats.currentStreak > 0
    ? `${stats.currentStreak}W streak`
    : stats.currentStreak < 0
    ? `${Math.abs(stats.currentStreak)}L streak`
    : "—";

  return (
    <div className="stats-panel">
      <h2>My form</h2>
      <div className="stats-grid">
        <div>
          <p className="stats-label">Bets</p>
          <p className="stats-value">{stats.totalBets}</p>
        </div>
        <div>
          <p className="stats-label">Form</p>
          <p className="stats-value">
            <span className="stats-win">{stats.wins}</span>
            {" / "}
            <span className="stats-loss">{stats.losses}</span>
          </p>
        </div>
        <div>
          <p className="stats-label">PnL</p>
          <p className={`stats-value ${pnlColor}`}>
            {stats.totalPnlLamports >= 0 ? "+" : ""}{SOL(stats.totalPnlLamports)}
          </p>
        </div>
        <div>
          <p className="stats-label">Streak</p>
          <p className="stats-value">{streakLabel}</p>
        </div>
      </div>
      <div className="stats-volume">
        Volume: {SOL(stats.totalVolumeLamports)}
        {stats.voids > 0 && ` · ${stats.voids} voided`}
        {publicKey && ` · ${publicKey.toBase58().slice(0, 8)}…`}
      </div>
    </div>
  );
}
