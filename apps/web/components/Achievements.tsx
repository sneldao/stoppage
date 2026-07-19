"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Position } from "@stoppage/sdk";
import type { SettledPosition } from "@/store";
import { computeHistoryStats } from "@/store/historySlice";

interface AchievementsProps {
  history: SettledPosition[];
  positions: Record<string, Position>;
}

interface Achievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_bet", emoji: "🎯", title: "First Call", description: "Placed your first bet" },
  { id: "first_win", emoji: "🏆", title: "First Win", description: "Won your first bet" },
  { id: "hot_streak", emoji: "🔥", title: "Hot Streak", description: "Won 3 bets in a row" },
  { id: "high_roller", emoji: "💰", title: "High Roller", description: "Staked 0.5 SOL or more" },
  { id: "speed_demon", emoji: "⚡", title: "Speed Demon", description: "Signed a bet in under 50ms" },
  { id: "social_sharer", emoji: "📢", title: "Social Sharer", description: "Shared a call on X" },
];

const STORAGE_KEY = "stoppage:achievements";

function loadCelebrated(): string[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveCelebrated(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function deriveUnlocked(history: SettledPosition[], positions: Record<string, Position>): string[] {
  const stats = computeHistoryStats(history);
  const unlocked: string[] = [];

  if (history.length > 0 || Object.keys(positions).length > 0) {
    unlocked.push("first_bet");
  }

  if (stats.wins > 0) {
    unlocked.push("first_win");
  }

  if (stats.currentStreak >= 3 || stats.bestStreak >= 3) {
    unlocked.push("hot_streak");
  }

  const allStakes = [
    ...history.map((h) => h.amountLamports),
    ...Object.values(positions).map((p) => p.amountLamports),
  ];
  if (allStakes.some((s) => s >= 0.5 * 1e9)) {
    unlocked.push("high_roller");
  }

  const fastSign = history.some((h) => h.signingMs !== undefined && h.signingMs < 50);
  if (fastSign) {
    unlocked.push("speed_demon");
  }

  return unlocked;
}

/** Lightweight achievement layer — celebrates milestones and shows progress. */
export function Achievements({ history, positions }: AchievementsProps) {
  const { publicKey } = useWallet();
  const [celebrated, setCelebrated] = useState<string[]>([]);

  useEffect(() => {
    setCelebrated(loadCelebrated());
  }, []);

  const unlocked = useMemo(() => deriveUnlocked(history, positions), [history, positions]);

  useEffect(() => {
    if (!publicKey) return;
    const newUnlocks = unlocked.filter((id) => !celebrated.includes(id));
    if (newUnlocks.length > 0) {
      saveCelebrated([...celebrated, ...newUnlocks]);
      setCelebrated((prev) => [...prev, ...newUnlocks]);
    }
  }, [publicKey, unlocked, celebrated]);

  if (!publicKey) return null;

  return (
    <section className="achievements" aria-label="Achievements">
      <div className="achievements-head">
        <p className="eyebrow">Milestones</p>
        <span>{unlocked.length} / {ACHIEVEMENTS.length}</span>
      </div>
      <div className="achievements-grid">
        {ACHIEVEMENTS.map((achievement) => {
          const isUnlocked = unlocked.includes(achievement.id);
          return (
            <div
              key={achievement.id}
              className={`achievement-card ${isUnlocked ? "achievement-card--unlocked" : ""}`}
              aria-label={isUnlocked ? "Unlocked" : "Locked"}
            >
              <span className="achievement-emoji" aria-hidden="true">{achievement.emoji}</span>
              <strong>{achievement.title}</strong>
              <span>{achievement.description}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
