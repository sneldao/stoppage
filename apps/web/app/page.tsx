"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSigningSpeed, formatMarketQuestion } from "@/lib/format";
import { useStoppageStore } from "@/store";
import { SetupPrompt } from "@/components/SetupPrompt";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { LiveInstrument } from "@/components/LiveInstrument";
import { StoppageClock } from "@/components/StoppageClock";
import { SharpMoves } from "@/components/SharpMoves";
import { MatchPulse } from "@/components/MatchPulse";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

function snapshotIsFresh(snapshot: LiveMatchSnapshot | null) {
  if (!snapshot?.updatedAt) return false;
  const ts = snapshot.updatedAt < 1_000_000_000_000
    ? snapshot.updatedAt * 1_000
    : snapshot.updatedAt;
  return Date.now() - ts <= 45_000;
}

// ─── Market Rail (sidecar) ────────────────────────────────────────────────────

function HeroMarketRail({ markets }: { markets: Market[] }) {
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

  // Fetch fixtures once on mount
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

  // Poll live score when a match is live
  useEffect(() => {
    if (!featuredFixture || !isLive(featuredFixture)) {
      setLiveSnapshot(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/fixtures/${featuredFixture.FixtureId}/score`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data: LiveMatchSnapshot) => { if (!cancelled) setLiveSnapshot(data); })
        .catch(() => { if (!cancelled) setLiveSnapshot(null); });
    };
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [featuredFixture]);

  // Detect score/stat changes → fire signal animations
  useEffect(() => {
    if (!liveSnapshot) return;
    const next = `${liveSnapshot.score.home}:${liveSnapshot.score.away}:${liveSnapshot.stats.corners}:${liveSnapshot.stats.cards}`;
    if (previousSignal.current && previousSignal.current !== next) {
      const [ph, pa, pc, pk] = previousSignal.current.split(":").map(Number);
      if (liveSnapshot.score.home !== ph || liveSnapshot.score.away !== pa) setLastSignalType("goal");
      else if (liveSnapshot.stats.cards !== pk) setLastSignalType("card");
      else if (liveSnapshot.stats.corners !== pc) setLastSignalType("corner");
      setSignalVersion((v) => v + 1);
    }
    previousSignal.current = next;
  }, [liveSnapshot]);

  // Auto-clear alert badge
  useEffect(() => {
    if (!lastSignalType) return;
    const t = setTimeout(() => setLastSignalType(null), 5_000);
    return () => clearTimeout(t);
  }, [lastSignalType]);

  const handleNewEvent = (evt: any) => {
    const map: Record<string, "goal" | "card" | "corner"> = {
      goal_scored: "goal", own_goal: "goal",
      card_shown: "card", corner_awarded: "corner",
    };
    const type = map[evt.type as string];
    if (type) { setLastSignalType(type); setSignalVersion((v) => v + 1); }
  };

  const marketHref = featuredMarket ? `/markets/${featuredMarket.id}` : "/markets";

  return (
    <main className="app-shell">

      {/* ── Live moment alert overlay ── */}
      {lastSignalType && (
        <div className={`moment-alert moment-alert--${lastSignalType}`} role="alert" aria-live="assertive">
          <div className="moment-alert-content">
            <span className="moment-alert-badge">⚡ Live update</span>
            <h2>
              {lastSignalType === "goal" && "GOAL SCORED! ⚽"}
              {lastSignalType === "card" && "CARD ISSUED! 🟨"}
              {lastSignalType === "corner" && "CORNER KICK! 🚩"}
            </h2>
            <p>
              {lastSignalType === "goal" && liveSnapshot ? `Score ${liveSnapshot.score.home} — ${liveSnapshot.score.away}` : null}
              {lastSignalType === "card" && liveSnapshot ? `Total cards: ${liveSnapshot.stats.cards}` : null}
              {lastSignalType === "corner" && liveSnapshot ? `Total corners: ${liveSnapshot.stats.corners}` : null}
            </p>
            <div className="moment-alert-loading" />
          </div>
        </div>
      )}

      {/* ── Command centre ── */}
      <section className="command-center">
        <MatchPulse live={isLive(featuredFixture)} signalVersion={signalVersion} lastSignalType={lastSignalType} />

        <div className="hero-clock" aria-hidden="true">
          <StoppageClock size={560} globalPointer />
        </div>

        {/* Left column: copy + CTA */}
        <div className="command-copy">
          <h1>Bet the next moment.</h1>
          <SetupPrompt marketHref={marketHref} />
          {state.delegated && lastSigningMs !== null && (
            <p className="hero-speed-note">
              <i className="live-dot" /> Last bet {formatSigningSpeed(lastSigningMs)}
            </p>
          )}
        </div>

        {/* Centre: single live instrument (match ↔ market) */}
        <div className="live-stage">
          <LiveInstrument
            fixture={featuredFixture}
            snapshot={liveSnapshot}
            market={featuredMarket}
            signalVersion={signalVersion}
            lastSignalType={lastSignalType}
            allFixtures={fixtures}
            onNewEvent={handleNewEvent}
          />
        </div>

        {/* Right sidecar: sharp signals + additional markets */}
        <div className="hero-sidecar">
          <SharpMoves />
          <HeroMarketRail markets={otherMarkets} />
        </div>
      </section>

      {/* ── Matchkeeper compact badge ── */}
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

      {/* ── Mobile sticky dock ── */}
      {!publicKey && (
        <a className="mobile-market-dock" href="#setup-prompt">
          <span><i /> Step 1 of 3</span>
          <strong>Connect wallet <b>→</b></strong>
        </a>
      )}
      {publicKey && !state.delegated && (
        <a className="mobile-market-dock" href="#setup-prompt">
          <span><i /> Step 2 of 3</span>
          <strong>Enable Fast Session <b>→</b></strong>
        </a>
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
