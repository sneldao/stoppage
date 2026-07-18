/**
 * History slice — tracks settled positions for PnL, streaks, and leaderboard.
 *
 * Settled positions are persisted to localStorage so the user's history
 * survives page reloads. The slice derives PnL, win/loss streak, and
 * total volume from the raw position records.
 */

import type { StateCreator } from "zustand";

const STORAGE_KEY = "stoppage:history";

export interface SettledPosition {
  marketId: string;
  owner: string;
  side: "yes" | "no";
  amountLamports: number;
  outcome: "yes" | "no" | "void";
  payoutLamports: number;
  settledAt: number;
  label: string;
  /** Signing speed in ms — used for the speed hero display. */
  signingMs?: number;
}

export interface HistorySlice {
  history: SettledPosition[];
  addSettledPosition: (pos: SettledPosition) => void;
  clearHistory: () => void;
  initHistory: () => void;
  /** Most recent signing speed (ms) — used by the execution strip speed stat. */
  lastSigningMs: number | null;
  setLastSigningMs: (ms: number) => void;
}

function loadHistory(): SettledPosition[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SettledPosition[];
  } catch {
    return [];
  }
}

function saveHistory(history: SettledPosition[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
}

export const createHistorySlice: StateCreator<
  HistorySlice,
  [],
  [],
  HistorySlice
> = (set) => ({
  history: [],
  lastSigningMs: null,
  addSettledPosition: (pos) =>
    set((state) => {
      // Avoid duplicates — same market + owner
      const filtered = state.history.filter(
        (h) => !(h.marketId === pos.marketId && h.owner === pos.owner)
      );
      const history = [pos, ...filtered].slice(0, 100); // cap at 100
      saveHistory(history);
      return { history };
    }),
  setLastSigningMs: (ms) => set({ lastSigningMs: ms }),
  clearHistory: () => {
    saveHistory([]);
    set({ history: [] });
  },
  initHistory: () => {
    set({ history: loadHistory() });
  },
});

// ── Derived stats ───────────────────────────────────────────────────

export interface HistoryStats {
  totalBets: number;
  wins: number;
  losses: number;
  voids: number;
  totalPnlLamports: number;
  totalVolumeLamports: number;
  currentStreak: number; // positive = win streak, negative = loss streak
  bestStreak: number;
}

export function computeHistoryStats(history: SettledPosition[]): HistoryStats {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let totalPnl = 0;
  let totalVolume = 0;

  // Sort by settledAt ascending for streak calculation
  const sorted = [...history].sort((a, b) => a.settledAt - b.settledAt);
  let currentStreak = 0;
  let bestStreak = 0;
  let streakType: "win" | "loss" | null = null;

  for (const pos of sorted) {
    totalVolume += pos.amountLamports;

    if (pos.outcome === "void") {
      voids++;
      // Void doesn't break or extend streak
      continue;
    }

    const isWin = pos.side === pos.outcome;
    if (isWin) {
      wins++;
      totalPnl += pos.payoutLamports - pos.amountLamports;
    } else {
      losses++;
      totalPnl -= pos.amountLamports;
    }

    const newType = isWin ? "win" : "loss";
    if (streakType === newType) {
      currentStreak += isWin ? 1 : -1;
    } else {
      currentStreak = isWin ? 1 : -1;
      streakType = newType;
    }
    const absStreak = Math.abs(currentStreak);
    if (absStreak > Math.abs(bestStreak)) {
      bestStreak = currentStreak;
    }
  }

  return {
    totalBets: history.length,
    wins,
    losses,
    voids,
    totalPnlLamports: totalPnl,
    totalVolumeLamports: totalVolume,
    currentStreak,
    bestStreak,
  };
}
