"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { computeHistoryStats } from "@/store/historySlice";
import type { SettledPosition } from "@/store";
import { buildTweetIntent } from "@/lib/share/tweet";

interface StreakCelebrationProps {
  history: SettledPosition[];
}

const STORAGE_KEY = "stoppage:celebrated_streak";

function getMilestone(streak: number): number | null {
  if (streak < 3) return null;
  const milestones = [3, 5, 10, 15, 20, 25, 50, 75, 100];
  for (let i = milestones.length - 1; i >= 0; i--) {
    if (streak >= milestones[i]) return milestones[i];
  }
  return null;
}

function loadCelebrated(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? Number(raw) : 0;
}

function saveCelebrated(milestone: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(milestone));
}

/** Celebrates win-streak milestones with a shareable moment. */
export function StreakCelebration({ history }: StreakCelebrationProps) {
  const { publicKey } = useWallet();
  const [dismissedMilestone, setDismissedMilestone] = useState<number | null>(null);

  const { milestone, stats } = useMemo(() => {
    const stats = computeHistoryStats(history);
    const milestone = stats.currentStreak > 0 ? getMilestone(stats.currentStreak) : null;
    return { milestone, stats };
  }, [history]);

  const celebrated = loadCelebrated();
  const visible = Boolean(publicKey && milestone && milestone > celebrated && milestone !== dismissedMilestone);

  const handleDismiss = () => {
    if (!milestone) return;
    saveCelebrated(milestone);
    setDismissedMilestone(milestone);
  };

  if (!visible) return null;

  const tweet = buildTweetIntent(
    `🔥 ${milestone} wins in a row on Stoppage. Verified on Solana. Who wants the next challenge? stoppage.fun`
  );

  return (
    <div className="streak-celebration" role="status" aria-live="polite">
      <div className="streak-celebration-content">
        <span className="streak-celebration-flames" aria-hidden="true">🔥🔥🔥</span>
        <h2>{milestone} in a row</h2>
        <p>
          You&apos;re on a {stats.currentStreak}-win streak. {stats.bestStreak > stats.currentStreak ? `Best ever: ${stats.bestStreak}.` : "This is your best run yet."}
        </p>
        <div className="streak-celebration-actions">
          <Link href="/markets" className="setup-guide-cta">
            Keep it going <span>→</span>
          </Link>
          <a href={tweet} target="_blank" rel="noopener noreferrer" className="returning-hero-link">
            Share on X
          </a>
          <button type="button" onClick={handleDismiss} className="streak-celebration-dismiss">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
