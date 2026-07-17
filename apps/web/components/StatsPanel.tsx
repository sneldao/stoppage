"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStoppageStore, computeHistoryStats } from "@/store";

const SOL = (lamports: number) => `${(lamports / 1e9).toFixed(3)} SOL`;

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
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-medium text-neutral-400">Your stats</h2>
        <p className="mt-2 text-xs text-neutral-600">
          No settled bets yet. Place a bet and come back after settlement to see your stats.
        </p>
      </div>
    );
  }

  const pnlColor = stats.totalPnlLamports > 0 ? "text-emerald-400"
    : stats.totalPnlLamports < 0 ? "text-red-400" : "text-neutral-400";

  const streakLabel = stats.currentStreak > 0
    ? `${stats.currentStreak}W streak`
    : stats.currentStreak < 0
    ? `${Math.abs(stats.currentStreak)}L streak`
    : "—";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-medium text-neutral-400">Your stats</h2>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-neutral-600">Bets</p>
          <p className="font-medium">{stats.totalBets}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-600">W / L</p>
          <p className="font-medium">
            <span className="text-emerald-400">{stats.wins}</span>
            {" / "}
            <span className="text-red-400">{stats.losses}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-600">PnL</p>
          <p className={`font-medium ${pnlColor}`}>
            {stats.totalPnlLamports >= 0 ? "+" : ""}{SOL(stats.totalPnlLamports)}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-600">Streak</p>
          <p className="font-medium">{streakLabel}</p>
        </div>
      </div>
      <div className="mt-2 text-xs text-neutral-600">
        Volume: {SOL(stats.totalVolumeLamports)}
        {stats.voids > 0 && ` · ${stats.voids} voided`}
        {publicKey && ` · ${publicKey.toBase58().slice(0, 8)}…`}
      </div>
    </div>
  );
}
