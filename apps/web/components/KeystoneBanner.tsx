"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCountdown } from "@/lib/time/useCountdown";
import { keystonePhase, keystoneTimes, KEYSTONE } from "@/lib/campaign/keystone";

/**
 * KeystoneBanner — the campaign surface on the tape and the home hero.
 * One match, two proof paths; links to /keystone. Phase-aware: counts
 * down to betting-open, then to kickoff, then tracks the receipts.
 */
export function KeystoneBanner({ compact = false }: { compact?: boolean }) {
  const times = keystoneTimes();

  // 30s tick so the phase line stays current without re-rendering every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const bettingOpenLabel = useCountdown(new Date(times.bettingOpensMs));
  const kickoffLabel = useCountdown(new Date(times.kickoffMs));

  const phase = keystonePhase(now, false);

  const statusLine =
    phase === "countdown"
      ? `Betting opens in ${bettingOpenLabel || "…"}`
      : phase === "betting_open"
      ? `Betting open · kickoff in ${kickoffLabel || "…"}`
      : phase === "in_play"
      ? "In play — the proof path is live"
      : "Full time — settlement proofs landing";

  return (
    <Link href="/keystone" className={`keystone-banner${compact ? " keystone-banner--compact" : ""}`}>
      <span className="keystone-banner-dot" aria-hidden="true">
        <i className="live-dot" />
      </span>
      <span className="keystone-banner-body">
        <strong>
          Sat · {KEYSTONE.homeTeam} v {KEYSTONE.awayTeam}
        </strong>
        <span className="keystone-banner-sub">{statusLine}</span>
      </span>
      <span className="keystone-banner-cta">{compact ? "→" : "The keystone match →"}</span>
    </Link>
  );
}
