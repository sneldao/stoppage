"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCountdown } from "@/lib/time/useCountdown";
import {
  NEXT_KEYSTONE,
  nextKeystonePhase,
  nextKeystoneTimes,
  type NextKeystonePhase,
} from "@/lib/campaign/keystone";

/**
 * KeystoneBanner — the hinge on home and the markets tape. Points at the
 * NEXT keystone: Arsenal v Coventry, the first staked settle.
 */
const ACTION: Record<NextKeystonePhase, { href: string; cta: string; compactCta: string }> = {
  countdown: { href: "/keystone", cta: "First staked settle →", compactCta: "Keystone →" },
  betting_open: { href: "/markets", cta: "Open the slip →", compactCta: "Bet →" },
  in_play: { href: "/keystone", cta: "Watch on-chain →", compactCta: "Live →" },
  awaiting_receipts: { href: "/keystone", cta: "Receipts landing →", compactCta: "Receipts →" },
};

export function KeystoneBanner({ compact = false }: { compact?: boolean }) {
  const times = nextKeystoneTimes();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const bettingOpen = useCountdown(new Date(times.bettingOpensMs));
  const kickoff = useCountdown(new Date(times.kickoffMs));
  const phase = nextKeystonePhase(now, false);
  const action = ACTION[phase];

  const statusLine =
    phase === "countdown"
      ? `Betting opens in ${bettingOpen || "…"}`
      : phase === "betting_open"
      ? `Betting open · kickoff in ${kickoff || "…"}`
      : phase === "in_play"
      ? "In play — the proof path is live"
      : "Full time — settlement proofs landing";

  return (
    <Link href={action.href} className={`keystone-banner${compact ? " keystone-banner--compact" : ""}`}>
      <span className="keystone-banner-still" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- campaign still */}
        <img src="/campaign/hero.jpg" alt="" />
      </span>
      <span className="keystone-banner-body">
        <strong>EPL keystone · {NEXT_KEYSTONE.homeTeam} v {NEXT_KEYSTONE.awayTeam}</strong>
        <span className="keystone-banner-sub">{statusLine}</span>
      </span>
      <span className="keystone-banner-cta">{compact ? action.compactCta : action.cta}</span>
    </Link>
  );
}
