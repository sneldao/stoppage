"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCountdown } from "@/lib/time/useCountdown";
import {
  keystonePhase,
  keystoneTimes,
  KEYSTONE,
  type KeystonePhase,
} from "@/lib/campaign/keystone";

/**
 * KeystoneBanner — the campaign hinge on home and the markets tape.
 * Same still as the socials; CTA names the action for the current phase.
 */
const PHASE_ACTION: Record<
  KeystonePhase,
  { href: string; cta: string; compactCta: string }
> = {
  countdown: {
    href: "/keystone#notify",
    cta: "Get on the list →",
    compactCta: "Notify →",
  },
  betting_open: {
    href: "/keystone",
    cta: "Open a slip →",
    compactCta: "Bet →",
  },
  in_play: {
    href: "/keystone",
    cta: "Watch live →",
    compactCta: "Live →",
  },
  awaiting_receipts: {
    href: "/keystone",
    cta: "Receipts landing →",
    compactCta: "Receipts →",
  },
  receipts: {
    href: "/keystone",
    cta: "Verify the proof →",
    compactCta: "Verify →",
  },
};

export function KeystoneBanner({ compact = false }: { compact?: boolean }) {
  const times = keystoneTimes();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const bettingOpenLabel = useCountdown(new Date(times.bettingOpensMs));
  const kickoffLabel = useCountdown(new Date(times.kickoffMs));

  const phase = keystonePhase(now, false);
  const action = PHASE_ACTION[phase];

  const statusLine =
    phase === "countdown"
      ? `Betting opens in ${bettingOpenLabel || "…"}`
      : phase === "betting_open"
      ? `Betting open · kickoff in ${kickoffLabel || "…"}`
      : phase === "in_play"
      ? "In play — the proof path is live"
      : "Full time — settlement proofs landing";

  return (
    <Link
      href={action.href}
      className={`keystone-banner${compact ? " keystone-banner--compact" : ""}`}
    >
      <span className="keystone-banner-still" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- campaign still */}
        <img src="/campaign/hero.jpg" alt="" />
      </span>
      <span className="keystone-banner-body">
        <strong>
          Sat · {KEYSTONE.homeTeam} v {KEYSTONE.awayTeam}
        </strong>
        <span className="keystone-banner-sub">{statusLine}</span>
      </span>
      <span className="keystone-banner-cta">
        {compact ? action.compactCta : action.cta}
      </span>
    </Link>
  );
}
