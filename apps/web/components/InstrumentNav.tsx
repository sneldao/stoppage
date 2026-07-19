"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useStoppageStore, computeHistoryStats } from "@/store";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-32" /> }
);

const routes = [
  { href: "/", label: "Live" },
  { href: "/match", label: "Match" },
  { href: "/markets", label: "Markets" },
];

export function InstrumentNav() {
  const pathname = usePathname();
  const { state } = useSessionKey();
  const history = useStoppageStore((s) => s.history);
  const stats = useMemo(() => computeHistoryStats(history), [history]);
  const isHotStreak = stats.currentStreak >= 3;

  return (
    <header className="app-nav instrument-nav">
      <Link href="/" className="wordmark" aria-label="Stoppage match desk">
        STOPPAGE<span>.</span>
        {isHotStreak && (
          <span className="hot-streak-badge" title={`On a hot streak of ${stats.currentStreak} wins!`}>
            🔥 {stats.currentStreak}
          </span>
        )}
      </Link>
      <nav className="nav-routes" aria-label="Primary navigation">
        {routes.map((route) => {
          const active = route.href === "/" ? pathname === "/" : pathname.startsWith(route.href);
          return <Link className={`nav-route ${active ? "active" : ""}`} href={route.href} key={route.href} aria-current={active ? "page" : undefined}>{route.label}</Link>;
        })}
      </nav>
      <Link href="/#setup-prompt" className="nav-session nav-session-link" title={state.expiresAt ? `One-tap betting expires ${new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Set up one-tap betting"}><i className={state.delegated ? "live-dot" : "schedule-dot"} /> {state.delegated ? "One-tap on" : "One-tap setup"}</Link>
      <div className="nav-wallet"><WalletMultiButton /></div>
    </header>
  );
}
