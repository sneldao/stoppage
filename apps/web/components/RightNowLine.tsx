"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStoppageStore } from "@/store";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { relTime } from "@/lib/activity/useActivityFeed";
import { formatSol as SOL, formatSigningSpeed } from "@/lib/format";

/**
 * RightNowLine — a single rotating "right now" fact on the home hero.
 *
 * Derived from data already in the store (markets + feed + positions +
 * session) PLUS a set of always-true facts (a ticking UTC clock, the
 * session expiry countdown, your record signing speed) so the line
 * never collapses to nothing when no external data is flowing. The
 * non-contingent baseline: even with zero markets, zero feed, and the
 * agent down, there is always a rotating fact on screen.
 */
export function RightNowLine() {
  const markets = useStoppageStore((s) => s.markets);
  const feed = useStoppageStore((s) => s.feed);
  const positions = useStoppageStore((s) => s.positions);
  const lastSigningMs = useStoppageStore((s) => s.lastSigningMs);
  const { state: sessionState } = useSessionKey();
  const sessionExpiresAt = sessionState.expiresAt;
  const { publicKey } = useWallet();

  // Tick every second so the UTC clock + session countdown stay live —
  // this re-renders only this component (canvas/siblings are memoized).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

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
    // — Always-true facts (non-contingent baseline) ————————
    // Session expiry countdown (ticking, always when delegated).
    if (sessionExpiresAt) {
      const ms = sessionExpiresAt - now;
      if (ms > 0) {
        const h = Math.floor(ms / 3_600_000);
        const m = Math.floor((ms % 3_600_000) / 60_000);
        out.push(`Session ${h}h ${m}m until cool-off`);
      }
    }
    // Record signing speed (personal stat, no external data).
    if (lastSigningMs !== null) out.push(`Your record bet ${formatSigningSpeed(lastSigningMs)}`);
    // A live UTC clock — always true, always moving.
    const d = new Date(now);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    out.push(`${hh}:${mm}:${ss} UTC · markets open with the match`);
    return out;
  }, [markets, feed, positions, publicKey, sessionExpiresAt, lastSigningMs, now]);  const [idx, setIdx] = useState(0);
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
