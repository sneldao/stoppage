"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useStoppageStore, computeHistoryStats } from "@/store";
import { getMatchSoundsEnabled, setMatchSoundsEnabled } from "@/components/LiveMatchBar";
import { formatSessionCountdown } from "@/lib/format";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-32" /> }
);

const primaryRoutes = [
  { href: "/", label: "Home", title: "Live desk — featured match and open markets" },
  { href: "/match", label: "Match room", title: "Scoreboard and every market for a match" },
  { href: "/markets", label: "Markets", title: "All markets, grouped by match" },
  { href: "/positions", label: "Positions", title: "Your open bets and history" },
];

const secondaryRoutes = [
  { href: "/calibration", label: "Calibration", title: "Model pricing calibration" },
  { href: "/operators", label: "Operators", title: "Validator integration for operators" },
];

/**
 * Nav link with visible progress: the route lights up the instant you
 * click it (pressed state) and stays lit until the new page renders.
 * Navigation runs through router.push inside startTransition, so
 * isPending genuinely tracks the route change; the pressed flag is a
 * safety net with a timeout for same-route clicks and cached navigations
 * that resolve before React reports pending. The busy state is mirrored
 * to the header via onBusy, which drives the nav-level progress bar.
 * Modifier/new-tab clicks fall through to the browser untouched.
 */
function NavRouteLink({
  href,
  label,
  title,
  active,
  secondary,
  onBusy,
}: {
  href: string;
  label: string;
  title: string;
  active: boolean;
  secondary?: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pressed, setPressed] = useState(false);
  const busy = isPending || pressed;

  useEffect(() => {
    onBusy(busy);
    return () => { if (busy) onBusy(false); };
  }, [busy, onBusy]);

  // Safety: never stay lit longer than a beat. Cached navigations and
  // same-route clicks resolve faster than React flips isPending, and a
  // hung route shouldn't leave the nav glowing forever.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setPressed(false), 1500);
    return () => window.clearTimeout(timer);
  }, [busy]);

  // Normal path: the transition's pending window closes once the new
  // route has rendered — drop the local pressed flag with it.
  useEffect(() => {
    if (!isPending && pressed) setPressed(false);
  }, [isPending, pressed]);

  return (
    <Link
      className={`nav-route ${secondary ? "nav-route--secondary" : ""} ${active ? "active" : ""} ${busy ? "nav-route--navigating" : ""}`}
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setPressed(true);
        startTransition(() => {
          router.push(href);
        });
      }}
    >
      {label}
    </Link>
  );
}

export function InstrumentNav() {
  const pathname = usePathname();
  const { state } = useSessionKey();
  const history = useStoppageStore((s) => s.history);
  const feedState = useStoppageStore((s) => s.feedState);
  const stats = useMemo(() => computeHistoryStats(history), [history]);
  const isHotStreak = stats.currentStreak >= 3;

  // Header-level progress bar: any route link busy → bar animates.
  const [anyBusy, setAnyBusy] = useState(false);
  // Belt-and-suspenders: a completed route change always clears the bar,
  // even if a link's busy flag were stuck.
  useEffect(() => { setAnyBusy(false); }, [pathname]);

  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => { setSoundOn(getMatchSoundsEnabled()); }, []);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setMatchSoundsEnabled(next);
  };

  const feedLabel = feedState === "connected" ? "Live" : feedState === "polling" ? "Polling" : "Offline";

  return (
    <header className={`app-nav instrument-nav ${anyBusy ? "instrument-nav--navigating" : ""}`}>
      <Link href="/" className="wordmark" aria-label="Stoppage match desk">
        STOPPAGE<span>.</span>
        {isHotStreak && (
          <span className="hot-streak-badge" title={`On a hot streak of ${stats.currentStreak} wins!`}>
            🔥 {stats.currentStreak}
          </span>
        )}
      </Link>
      <nav className="nav-routes" aria-label="Primary navigation">
        {primaryRoutes.map((route) => {
          const active = route.href === "/" ? pathname === "/" : pathname.startsWith(route.href);
          return (
            <NavRouteLink
              key={route.href}
              href={route.href}
              label={route.label}
              title={route.title}
              active={active}
              onBusy={setAnyBusy}
            />
          );
        })}
        {secondaryRoutes.map((route) => (
          <NavRouteLink
            key={route.href}
            href={route.href}
            label={route.label}
            title={route.title}
            active={pathname.startsWith(route.href)}
            secondary
            onBusy={setAnyBusy}
          />
        ))}
      </nav>
      <div className="nav-right-cluster">
        <span className={`nav-feed nav-feed--${feedState}`} title={`On-chain feed: ${feedLabel.toLowerCase()}`}>
          <i className={feedState === "connected" ? "live-dot" : feedState === "polling" ? "schedule-dot" : "offline-dot"} />
          <span className="nav-feed-label">{feedLabel}</span>
        </span>
        <button type="button" className="nav-sound-toggle" onClick={toggleSound} aria-label={soundOn ? "Mute match sounds" : "Unmute match sounds"} title={soundOn ? "Mute match sounds" : "Unmute match sounds"}>
          {soundOn ? "🔊" : "🔇"}
        </button>
        <Link
          href="/#setup-prompt"
          className={`nav-session nav-session-link ${state.delegated ? "nav-session--active" : ""}`}
          title={state.expiresAt ? `One-tap expires ${formatSessionCountdown(state.expiresAt)}` : "Set up one-tap betting"}
        >
          <i className={state.delegated ? "live-dot" : "schedule-dot"} />
          <span className="nav-session-text">
            {state.delegated && state.expiresAt
              ? `One-tap · ${formatSessionCountdown(state.expiresAt)}`
              : state.paused
              ? "Paused"
              : "One-tap"}
          </span>
        </Link>
      </div>
      <div className="nav-wallet"><WalletMultiButton /></div>
    </header>
  );
}
