"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSol as SOL, formatMarketQuestion, countryFlag, formatSigningSpeed } from "@/lib/format";
import { useStoppageStore } from "@/store";
import { SetupPrompt } from "@/components/SetupPrompt";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ElectricBorder } from "@/components/ElectricBorder";
import { LiveMatchBar } from "@/components/LiveMatchBar";
import { StoppageClock } from "@/components/StoppageClock";
import { SharpMoves } from "@/components/SharpMoves";
import { MatchPulse } from "@/components/MatchPulse";

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

function matchIdFromFixture(fixture: Fixture): string {
  const code = (name: string) => {
    const parts = name.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return last.length >= 3 ? last.slice(0, 3).toUpperCase() : last.toUpperCase();
  };
  return `${code(fixture.Participant1)}-${code(fixture.Participant2)}`;
}

interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

function snapshotIsFresh(snapshot: LiveMatchSnapshot | null) {
  if (!snapshot?.updatedAt) return false;
  const timestamp = snapshot.updatedAt < 1_000_000_000_000
    ? snapshot.updatedAt * 1_000
    : snapshot.updatedAt;
  return Date.now() - timestamp <= 45_000;
}

// ─── Match Board ──────────────────────────────────────────────────────────────

function MatchBoard({
  fixture,
  snapshot,
  signalVersion,
  onNewEvent,
}: {
  fixture: Fixture | null;
  snapshot: LiveMatchSnapshot | null;
  signalVersion: number;
  onNewEvent?: (evt: any) => void;
}) {
  const live = isLive(fixture);
  const fresh = snapshotIsFresh(snapshot);

  return (
    <ElectricBorder variant="blue" speed={1.5} displacement={30} active={live}>
      <section className="match-board" aria-label="Current match">
        <div className="signal-grid" aria-hidden="true">
          {Array.from({ length: 64 }, (_, index) => <i key={index} />)}
        </div>
        {signalVersion > 0 && (
          <div className="signal-ripple" key={signalVersion} aria-hidden="true">
            <i /><i /><i />
          </div>
        )}
        <div className="match-board-top">
          <span className={live ? "match-live" : "match-next"}>
            <i /> {live ? "Live" : "Next fixture"}
          </span>
          <span>{live ? (fresh ? "Feed current" : "Feed delayed") : "TxLINE feed"}</span>
        </div>
        <div className="scoreline">
          <strong>{fixture?.Participant1 ?? "Home"}</strong>
          <span
            className={`score ${signalVersion > 0 ? "score-flash" : ""}`}
            key={signalVersion}
          >
            {live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}
          </span>
          <strong>{fixture?.Participant2 ?? "Away"}</strong>
        </div>
        <div className="match-board-foot">
          <span>
            <span className="match-country-flag">{countryFlag(fixture?.Country ?? "")}</span>{" "}
            {fixture?.Country ?? "World Cup"}
          </span>
          <span>
            {live && snapshot
              ? `Corners ${snapshot.stats.corners} · Cards ${snapshot.stats.cards}`
              : !live && fixture
              ? new Date(fixture.StartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "Waiting for fixture"}
          </span>
        </div>
        {fixture && (
          <LiveMatchBar matchId={matchIdFromFixture(fixture)} onNewEvent={onNewEvent} />
        )}
      </section>
    </ElectricBorder>
  );
}

// ─── Featured Market ──────────────────────────────────────────────────────────

function FeaturedMarket({ market }: { market: Market | null }) {
  const [pendingStake, setPendingStake] = useState<string | null>(null);

  if (!market) {
    return (
      <section className="featured-market featured-market-empty">
        <p className="eyebrow">Markets</p>
        <h1>Markets open with the match.</h1>
        <p>The next market will appear here as soon as it is published.</p>
        <Link className="quiet-link" href="/markets">Browse markets</Link>
      </section>
    );
  }

  const odds = impliedProbability(market);
  const pool = market.yesPool + market.noPool;
  const href = `/markets/${market.id}`;
  const stakeParam = pendingStake ? `&stake=${pendingStake}` : "";

  const STAKES = ["0.01", "0.05", "0.10"];

  return (
    <ElectricBorder variant="lime" speed={1.0} displacement={25} active={market.status === "open"}>
      <section className="featured-market" aria-labelledby="featured-market-title">
        <div className="market-kicker">
          <span className="live-label"><i /> Live market</span>
          <span>{SOL(pool)} pool</span>
        </div>
        <h1 id="featured-market-title">{formatMarketQuestion(market.predicate)}</h1>
        <p className="market-meta">
          Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · independently resolvable
        </p>
        <div className="outcome-cells">
          <Link href={`${href}?side=yes${stakeParam}`} className="outcome-cell outcome-yes">
            <span>YES</span>
            <strong>{Math.round(odds.yes * 100)}%</strong>
            <small>{odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x return` : "Market opening"}</small>
          </Link>
          <Link href={`${href}?side=no${stakeParam}`} className="outcome-cell outcome-no">
            <span>NO</span>
            <strong>{Math.round(odds.no * 100)}%</strong>
            <small>{odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x return` : "Market opening"}</small>
          </Link>
        </div>
        {/* Interactive stake selector — pre-fills the bet slip */}
        <div className="stake-hint" role="group" aria-label="Quick stake">
          {STAKES.map((s) => (
            <button
              key={s}
              type="button"
              className={`stake-hint-btn${pendingStake === s ? " stake-hint-btn--active" : ""}`}
              onClick={() => setPendingStake(pendingStake === s ? null : s)}
              aria-pressed={pendingStake === s}
            >
              {s}
            </button>
          ))}
          <span className="stake-hint-label">SOL · tap to pre-fill slip</span>
        </div>
      </section>
    </ElectricBorder>
  );
}

// ─── Market Rail ──────────────────────────────────────────────────────────────

function HeroMarketRail({ markets }: { markets: Market[] }) {
  // Don't render the rail until there's enough to justify a "more" section
  if (markets.length < 2) return null;

  return (
    <section className="hero-market-rail" aria-labelledby="hero-market-rail-title">
      <div className="hero-rail-head">
        <p className="eyebrow" id="hero-market-rail-title">More markets</p>
        <Link href="/markets">All <span>→</span></Link>
      </div>
      <div className="hero-market-tape">
        {markets.map((market) => {
          const odds = impliedProbability(market);
          return (
            <Link className="hero-market-ticket" href={`/markets/${market.id}`} key={market.id}>
              <strong>{formatMarketQuestion(market.predicate)}</strong>
              <span><b>{Math.round(odds.yes * 100)}%</b> YES</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { markets } = useMarkets();
  useHeliusMonitor();
  const { publicKey } = useWallet();
  const { state } = useSessionKey();
  const lastSigningMs = useStoppageStore((s) => s.lastSigningMs);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMatchSnapshot | null>(null);
  const [signalVersion, setSignalVersion] = useState(0);
  const [lastSignalType, setLastSignalType] = useState<"goal" | "corner" | "card" | null>(null);
  const previousSignal = useRef<string | null>(null);

  // Fetch fixtures once
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Fixture feed unavailable"))))
      .then((data) => { if (!cancelled) setFixtures(data.fixtures ?? []); })
      .catch(() => { if (!cancelled) setFixtures([]); });
    return () => { cancelled = true; };
  }, []);

  const featuredMarket = useMemo(
    () => Object.values(markets).find((m) => m.status === "open") ?? null,
    [markets],
  );
  const featuredFixture = useMemo(
    () => fixtures.find((f) => isLive(f)) ?? fixtures[0] ?? null,
    [fixtures],
  );
  const otherMarkets = useMemo(
    () => Object.values(markets).filter((m) => m.id !== featuredMarket?.id).slice(0, 3),
    [markets, featuredMarket],
  );

  // Poll live score
  useEffect(() => {
    if (!featuredFixture || !isLive(featuredFixture)) {
      setLiveSnapshot(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/fixtures/${featuredFixture.FixtureId}/score`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Score unavailable"))))
        .then((data: LiveMatchSnapshot) => { if (!cancelled) setLiveSnapshot(data); })
        .catch(() => { if (!cancelled) setLiveSnapshot(null); });
    };
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [featuredFixture]);

  // Detect score/stat changes and fire signal animations
  useEffect(() => {
    if (!liveSnapshot) return;
    const next = `${liveSnapshot.score.home}:${liveSnapshot.score.away}:${liveSnapshot.stats.corners}:${liveSnapshot.stats.cards}`;
    if (previousSignal.current && previousSignal.current !== next) {
      const [ph, pa, pc, pk] = previousSignal.current.split(":").map(Number);
      if (liveSnapshot.score.home !== ph || liveSnapshot.score.away !== pa) {
        setLastSignalType("goal");
      } else if (liveSnapshot.stats.cards !== pk) {
        setLastSignalType("card");
      } else if (liveSnapshot.stats.corners !== pc) {
        setLastSignalType("corner");
      }
      setSignalVersion((v) => v + 1);
    }
    previousSignal.current = next;
  }, [liveSnapshot]);

  // Auto-clear signal type badge after 5 s
  useEffect(() => {
    if (!lastSignalType) return;
    const t = setTimeout(() => setLastSignalType(null), 5_000);
    return () => clearTimeout(t);
  }, [lastSignalType]);

  const handleNewEvent = (evt: any) => {
    const map: Record<string, "goal" | "card" | "corner"> = {
      goal_scored: "goal",
      own_goal: "goal",
      card_shown: "card",
      corner_awarded: "corner",
    };
    const type = map[evt.type as string];
    if (type) {
      setLastSignalType(type);
      setSignalVersion((v) => v + 1);
    }
  };

  const marketHref = featuredMarket ? `/markets/${featuredMarket.id}` : "/markets";

  return (
    <main className="app-shell">

      {/* ── Live moment alert ── */}
      {lastSignalType && (
        <div
          className={`moment-alert moment-alert--${lastSignalType}`}
          role="alert"
          aria-live="assertive"
        >
          <div className="moment-alert-content">
            <span className="moment-alert-badge">⚡ Live update</span>
            <h2>
              {lastSignalType === "goal" && "GOAL SCORED! ⚽"}
              {lastSignalType === "card" && "CARD ISSUED! 🟨"}
              {lastSignalType === "corner" && "CORNER KICK! 🚩"}
            </h2>
            <p>
              {lastSignalType === "goal" && liveSnapshot
                ? `Score is now ${liveSnapshot.score.home} — ${liveSnapshot.score.away}`
                : lastSignalType === "card" && liveSnapshot
                ? `Total cards: ${liveSnapshot.stats.cards}`
                : lastSignalType === "corner" && liveSnapshot
                ? `Total corners: ${liveSnapshot.stats.corners}`
                : null}
            </p>
            <div className="moment-alert-loading" />
          </div>
        </div>
      )}

      {/* ── Command centre ── */}
      <section className="command-center">
        <MatchPulse
          live={isLive(featuredFixture)}
          signalVersion={signalVersion}
          lastSignalType={lastSignalType}
        />

        {/* Background clock — decorative */}
        <div className="hero-clock" aria-hidden="true">
          <StoppageClock size={560} globalPointer />
        </div>

        {/* Hero copy + single CTA */}
        <div className="command-copy">
          <h1>Bet the next moment.</h1>
          <SetupPrompt marketHref={marketHref} />
          {state.delegated && lastSigningMs !== null && (
            <p className="hero-speed-note">
              <i className="live-dot" /> Last bet {formatSigningSpeed(lastSigningMs)}
            </p>
          )}
        </div>

        {/* Live stage: match board + featured market */}
        <div className="live-stage">
          <MatchBoard
            fixture={featuredFixture}
            snapshot={liveSnapshot}
            signalVersion={signalVersion}
            onNewEvent={handleNewEvent}
          />
          <FeaturedMarket market={featuredMarket} />
        </div>

        {/* Sidecar: sharp signals + additional markets */}
        <div className="hero-sidecar">
          <SharpMoves />
          <HeroMarketRail markets={otherMarkets} />
        </div>
      </section>

      {/* ── Matchkeeper status badge row ── */}
      <div className="keeper-strip" aria-label="Agent status">
        <MatchkeeperStatus
          updatedAt={liveSnapshot?.updatedAt}
          marketPhase={featuredMarket?.status}
          compact
        />
      </div>

      <footer className="app-footer">
        <div>
          <Link href="/" className="wordmark">STOPPAGE<span>.</span></Link>
          <span>© 2026</span>
        </div>
        <p>Built on Solana devnet · Match data from TxLINE</p>
        <p className="footer-safety">Use only where permitted. Set limits and take breaks.</p>
      </footer>

      {/* ── Mobile sticky dock — single CTA, thumb-accessible ── */}
      {!publicKey && (
        <a className="mobile-market-dock" href="#setup-prompt">
          <span><i /> Step 1 of 3</span>
          <strong>Connect wallet <b>→</b></strong>
        </a>
      )}
      {publicKey && !state.delegated && (
        <Link className="mobile-market-dock" href="#setup-prompt">
          <span><i /> Step 2 of 3</span>
          <strong>Enable Fast Session <b>→</b></strong>
        </Link>
      )}
      {publicKey && state.delegated && featuredMarket && (
        <Link className="mobile-market-dock" href={`/markets/${featuredMarket.id}`}>
          <span><i /> Live market open</span>
          <strong>Place your bet <b>→</b></strong>
        </Link>
      )}
    </main>
  );
}
