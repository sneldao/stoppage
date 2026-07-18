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
import { FirstRunGuide } from "@/components/FirstRunGuide";
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
  const timestamp = snapshot.updatedAt < 1_000_000_000_000 ? snapshot.updatedAt * 1_000 : snapshot.updatedAt;
  return Date.now() - timestamp <= 45_000;
}

function MatchBoard({ fixture, snapshot, signalVersion }: { fixture: Fixture | null; snapshot: LiveMatchSnapshot | null; signalVersion: number }) {
  const live = isLive(fixture);
  const fresh = snapshotIsFresh(snapshot);
  return (
    <ElectricBorder variant="blue" speed={1.5} displacement={30} active={live}>
      <section className="match-board" aria-label="Current match">
        <div className="signal-grid" aria-hidden="true">
          {Array.from({ length: 64 }, (_, index) => <i key={index} />)}
        </div>
        {signalVersion > 0 && <div className="signal-ripple" key={signalVersion} aria-hidden="true"><i /><i /><i /></div>}
        <div className="match-board-top">
          <span className={live ? "match-live" : "match-next"}><i /> {live ? "Live" : "Next fixture"}</span>
          <span>{live ? fresh ? "Feed current" : "Feed delayed" : "TxLINE feed"}</span>
        </div>
        <div className="scoreline">
          <strong>{fixture?.Participant1 ?? "Home"}</strong>
          <span className={`score ${signalVersion > 0 ? "score-flash" : ""}`} key={signalVersion}>{live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</span>
          <strong>{fixture?.Participant2 ?? "Away"}</strong>
        </div>
        <div className="match-board-foot">
          <span><span className="match-country-flag">{countryFlag(fixture?.Country ?? "")}</span> {fixture?.Country ?? "World Cup"}</span>
          <span>{live && snapshot ? `Corners ${snapshot.stats.corners} · Cards ${snapshot.stats.cards}${snapshot.updatedAt ? ` · ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : live ? "Live data delayed" : fixture ? new Date(fixture.StartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting for fixture"}</span>
        </div>
        {fixture && <LiveMatchBar matchId={matchIdFromFixture(fixture)} />}
      </section>
    </ElectricBorder>
  );
}

function FeaturedMarket({ market }: { market: Market | null }) {
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
  return (
    <ElectricBorder variant="lime" speed={1.0} displacement={25} active={market.status === "open"}>
      <section className="featured-market" aria-labelledby="featured-market-title">
        <div className="market-kicker">
          <span className="live-label"><i /> Live market</span>
          <span>{SOL(pool)} pool</span>
        </div>
        <h1 id="featured-market-title">{formatMarketQuestion(market.predicate)}</h1>
        <p className="market-meta">Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · independently resolvable</p>
        <div className="outcome-cells">
          <Link href={`${href}?side=yes`} className="outcome-cell outcome-yes">
            <span>YES</span><strong>{Math.round(odds.yes * 100)}%</strong><small>{odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x return` : "Market opening"}</small>
          </Link>
          <Link href={`${href}?side=no`} className="outcome-cell outcome-no">
            <span>NO</span><strong>{Math.round(odds.no * 100)}%</strong><small>{odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x return` : "Market opening"}</small>
          </Link>
        </div>
        <div className="stake-hint"><span>0.01</span><span>0.05</span><span>0.10</span><span>Custom stake in slip</span></div>
      </section>
    </ElectricBorder>
  );
}

export default function Home() {
  const { markets } = useMarkets();
  useHeliusMonitor();
  const { publicKey } = useWallet();
  const { state } = useSessionKey();
  const lastSigningMs = useStoppageStore((s) => s.lastSigningMs);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMatchSnapshot | null>(null);
  const [signalVersion, setSignalVersion] = useState(0);
  const previousSignal = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Fixture feed unavailable"))))
      .then((data) => { if (!cancelled) setFixtures(data.fixtures ?? []); })
      .catch(() => { if (!cancelled) setFixtures([]); });
    return () => { cancelled = true; };
  }, []);

  const featuredMarket = useMemo(() => Object.values(markets).find((market) => market.status === "open") ?? null, [markets]);
  const featuredFixture = useMemo(() => fixtures.find((fixture) => isLive(fixture)) ?? fixtures[0] ?? null, [fixtures]);
  const otherMarkets = useMemo(() => Object.values(markets).filter((market) => market.id !== featuredMarket?.id).slice(0, 3), [markets, featuredMarket]);

  useEffect(() => {
    if (!featuredFixture || !isLive(featuredFixture)) {
      setLiveSnapshot(null);
      return;
    }
    let cancelled = false;
    const refreshScore = () => {
      void fetch(`/api/fixtures/${featuredFixture.FixtureId}/score`)
        .then((res) => res.ok ? res.json() : Promise.reject(new Error("Score feed unavailable")))
        .then((data: LiveMatchSnapshot) => { if (!cancelled) setLiveSnapshot(data); })
        .catch(() => { if (!cancelled) setLiveSnapshot(null); });
    };
    refreshScore();
    const interval = window.setInterval(refreshScore, 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [featuredFixture]);

  useEffect(() => {
    if (!liveSnapshot) return;
    const nextSignal = `${liveSnapshot.score.home}:${liveSnapshot.score.away}:${liveSnapshot.stats.corners}:${liveSnapshot.stats.cards}`;
    if (previousSignal.current && previousSignal.current !== nextSignal) setSignalVersion((version) => version + 1);
    previousSignal.current = nextSignal;
  }, [liveSnapshot]);

  return (
    <main className="app-shell">
      <section className="command-center">
        <MatchPulse live={isLive(featuredFixture)} signalVersion={signalVersion} />
        <div className="hero-clock" aria-hidden="true">
          <StoppageClock size={560} globalPointer />
        </div>
        <div className="command-copy">
          <p className="eyebrow">Live match</p>
          <h1>Bet the next moment.</h1>
          <p className="lede">Short markets, live match data, local signing, and a proof trail you can verify.</p>
          <Link className="copy-link" href="/markets">Browse markets <span>→</span></Link>
        </div>
        <div className="live-stage">
          <MatchBoard fixture={featuredFixture} snapshot={liveSnapshot} signalVersion={signalVersion} />
          <FeaturedMarket market={featuredMarket} />
        </div>
      </section>

      <section className="execution-strip" aria-label="Session status">
        <span className={state.delegated ? "execution-ready" : "execution-pending"}><i /> {state.delegated ? `No popups · last bet ${lastSigningMs !== null ? formatSigningSpeed(lastSigningMs) : "ready"}` : "Enable Fast Session for no-popup bets"}</span>
        <span>{state.delegated ? "Ready to bet" : "One approval to activate"}</span>
        <span>Proof path connected</span>
      </section>

      <section className="lower-grid">
        <div className="market-rail">
          <div className="section-heading"><div><p className="eyebrow">Live markets</p><h2>More ways to bet.</h2></div><Link href="/markets">All markets <span>→</span></Link></div>
          {otherMarkets.length > 0 ? (
            <div className="market-list">
              {otherMarkets.map((market) => {
                const odds = impliedProbability(market);
                return <Link className="market-signal" href={`/markets/${market.id}`} key={market.id}><div><span className="market-signal-kind">{formatMarketQuestion(market.predicate)}</span><strong>{formatMarketQuestion(market.predicate)}</strong></div><div className="market-signal-odds"><b>{Math.round(odds.yes * 100)}%</b><span>YES</span></div></Link>;
              })}
            </div>
          ) : <div className="empty-rail">Markets update when a verified match event creates a new opportunity.</div>}
        </div>

        <div className="onboarding-stack">
          <FirstRunGuide marketHref={featuredMarket ? `/markets/${featuredMarket.id}` : "/markets"} />
          <MatchkeeperStatus updatedAt={liveSnapshot?.updatedAt} marketPhase={featuredMarket?.status} />
          <SharpMoves />
        </div>
      </section>

      <footer className="app-footer"><div><Link href="/" className="wordmark">STOPPAGE<span>.</span></Link><span>© 2026</span></div><p>Built on Solana devnet · Match data from TxLINE</p><p className="footer-safety">Use only where permitted. Set limits and take breaks.</p></footer>

      {!publicKey && <a className="mobile-market-dock" href="#fast-setup"><span><i /> Step 1 of 3</span><strong>Connect wallet <b>→</b></strong></a>}
      {publicKey && !state.delegated && <a className="mobile-market-dock" href="#fast-setup"><span><i /> Step 2 of 3</span><strong>Enable Fast Session <b>→</b></strong></a>}
      {publicKey && state.delegated && featuredMarket && <Link className="mobile-market-dock" href={`/markets/${featuredMarket.id}`}><span><i /> Step 3 of 3</span><strong>Place your first bet <b>→</b></strong></Link>}
    </main>
  );
}
