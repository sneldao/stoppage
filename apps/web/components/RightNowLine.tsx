"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStoppageStore } from "@/store";
import { relTime } from "@/lib/activity/useActivityFeed";
import { formatSol as SOL } from "@/lib/format";

/**
 * RightNowLine — a single rotating "right now" fact on the home hero.
 *
 * All derived from data already in the store (markets + feed + positions):
 * market counts, total locked liquidity (reactive to Helius odds ticks),
 * last keeper activity, and the user's own at-risk stake. Rotates every
 * ~4s. No extra polling — reads the same slices everything else does.
 */
export function RightNowLine() {
  const markets = useStoppageStore((s) => s.markets);
  const feed = useStoppageStore((s) => s.feed);
  const positions = useStoppageStore((s) => s.positions);
  const { publicKey } = useWallet();

  const facts = useMemo(() => {
    const all = Object.values(markets);
    const open = all.filter((m) => m.status === "open").length;
    const settling = all.filter((m) => m.status === "awaiting_settlement").length;
    const locked = all.reduce((sum, m) => sum + m.yesPool + m.noPool, 0);
    const out: string[] = [];
    out.push(`${open} market${open === 1 ? "" : "s"} live${settling ? ` · ${settling} settling` : ""}`);
    if (all.length) out.push(`${SOL(locked)} locked across ${all.length} market${all.length === 1 ? "" : "s"}`);
    const lastSettled = feed.find((e) => e.kind === "settlement_confirmed");
    if (lastSettled) out.push(`Last settled ${relTime(lastSettled.occurredAt)} ago`);
    if (feed[0]) out.push(`Last activity ${relTime(feed[0].occurredAt)} ago`);
    if (publicKey) {
      const owner = publicKey.toBase58();
      const mine = Object.values(positions).filter((p) => p.owner === owner && p.amountLamports > 0);
      if (mine.length) {
        const atRisk = mine.reduce((s, p) => s + p.amountLamports, 0);
        out.push(`You hold ${mine.length} open · ${SOL(atRisk)} at risk`);
      }
    }
    return out;
  }, [markets, feed, positions, publicKey]);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (facts.length <= 1) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % facts.length), 4_200);
    return () => window.clearInterval(id);
  }, [facts.length]);

  if (facts.length === 0) return null;
  return (
    <p className="right-now-line" aria-live="polite">
      <i className="live-dot" /> <span key={idx}>{facts[idx % facts.length]}</span>
    </p>
  );
}
