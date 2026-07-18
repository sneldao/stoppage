"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, PREDICATE_LABEL, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSol as SOL } from "@/lib/format";

function marketQuestion(market: Market) {
  const predicate = market.predicate;
  const param = predicate.params.windowSeconds ?? predicate.params.threshold ?? "";
  const team = predicate.params.team ? ` for ${predicate.params.team}` : "";
  return `${PREDICATE_LABEL[predicate.kind] ?? predicate.kind} ${param}${team}`;
}

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

function MatchBoard({ fixture, snapshot, signalVersion }: { fixture: Fixture | null; snapshot: LiveMatchSnapshot | null; signalVersion: number }) {
  const live = isLive(fixture);
  return (
    <section className="match-board" aria-label="Current match">
      <div className="signal-grid" aria-hidden="true">
        {Array.from({ length: 64 }, (_, index) => <i key={index} />)}
      </div>
      {signalVersion > 0 && <div className="signal-ripple" key={signalVersion} aria-hidden="true"><i /><i /><i /></div>}
      <div className="match-board-top">
        <span className={live ? "match-live" : "match-next"}><i /> {live ? "Live" : "Next fixture"}</span>
        <span>TxLINE feed</span>
      </div>
      <div className="scoreline">
        <strong>{fixture?.Participant1 ?? "Home"}</strong>
        <span className="score" key={signalVersion}>{live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</span>
        <strong>{fixture?.Participant2 ?? "Away"}</strong>
      </div>
      <div className="match-board-foot">
        <span>{fixture?.Country ?? "World Cup"}</span>
        <span>{live && snapshot ? `Corners ${snapshot.stats.corners} · Cards ${snapshot.stats.cards}${snapshot.updatedAt ? ` · ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : live ? "In-play data connected" : fixture ? new Date(fixture.StartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting for fixture"}</span>
      </div>
    </section>
  );
}

function FeaturedMarket({ market }: { market: Market | null }) {
  if (!market) {
    return (
      <section className="featured-market featured-market-empty">
        <p className="eyebrow">Market engine</p>
        <h1>Markets open with the match.</h1>
        <p>The next TxLINE-triggered market will appear here as soon as it is published.</p>
        <Link className="quiet-link" href="/markets">View market tape</Link>
      </section>
    );
  }

  const odds = impliedProbability(market);
  const pool = market.yesPool + market.noPool;
  const href = `/markets/${market.id}`;
  return (
    <section className="featured-market" aria-labelledby="featured-market-title">
      <div className="market-kicker">
        <span className="live-label"><i /> Live market</span>
        <span>{SOL(pool)} pool</span>
      </div>
      <h1 id="featured-market-title">{marketQuestion(market)}</h1>
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
  );
}

export default function Home() {
  const { markets } = useMarkets();
  useHeliusMonitor();
  const { publicKey } = useWallet();
  const { state, delegate, revoke } = useSessionKey();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMatchSnapshot | null>(null);
  const [signalVersion, setSignalVersion] = useState(0);
  const previousSignal = useRef<string | null>(null);
  const [busy, setBusy] = useState<"delegate" | "revoke" | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

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

  const runSession = async (action: "delegate" | "revoke") => {
    setBusy(action);
    setSessionError(null);
    try {
      await (action === "delegate" ? delegate() : revoke());
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Session action failed");
    } finally {
      setBusy(null);
    }
  };

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
        <div className="command-copy">
          <p className="eyebrow">Live match instrument</p>
          <h1>Read the next moment.</h1>
          <p className="lede">Short markets, live match data, local signing, and a proof trail you can inspect.</p>
          <Link className="copy-link" href="/markets">Browse the live tape <span>→</span></Link>
        </div>
        <div className="live-stage">
          <MatchBoard fixture={featuredFixture} snapshot={liveSnapshot} signalVersion={signalVersion} />
          <FeaturedMarket market={featuredMarket} />
        </div>
      </section>

      <section className="execution-strip" aria-label="Execution status">
        <span className={state.delegated ? "execution-ready" : "execution-pending"}><i /> {state.delegated ? "Signed locally · no popup" : "Enable a session for no-popup actions"}</span>
        <span>{state.delegated ? "Ready to submit" : "One approval to activate"}</span>
        <span>Proof path connected</span>
      </section>

      <section className="lower-grid">
        <div className="market-rail">
          <div className="section-heading"><div><p className="eyebrow">Live pulse</p><h2>More ways to read play.</h2></div><Link href="/markets">All markets <span>→</span></Link></div>
          {otherMarkets.length > 0 ? (
            <div className="market-list">
              {otherMarkets.map((market) => {
                const odds = impliedProbability(market);
                return <Link className="market-signal" href={`/markets/${market.id}`} key={market.id}><div><span className="market-signal-kind">{PREDICATE_LABEL[market.predicate.kind] ?? market.predicate.kind}</span><strong>{marketQuestion(market)}</strong></div><div className="market-signal-odds"><b>{Math.round(odds.yes * 100)}%</b><span>YES</span></div></Link>;
              })}
            </div>
          ) : <div className="empty-rail">The market tape updates when a verified fixture event creates a new read.</div>}
        </div>

        <aside className="session-panel">
          <div className="session-panel-head"><p className="eyebrow">Session status</p><span className={state.delegated ? "status-pill active" : "status-pill"}>{state.delegated ? "Fast on" : "Offline"}</span></div>
          <h2>{state.delegated ? "Ready between moments." : "Set up once. Move quickly."}</h2>
          <p>{state.delegated ? "Eligible market actions are signed locally. Your wallet stays out of the live decision." : "Create a limited session key for eligible markets. Every action remains bounded and revocable."}</p>
          {publicKey && !state.delegated && <button className="session-action" disabled={busy !== null} onClick={() => void runSession("delegate")}>{busy === "delegate" ? "Activating session…" : "Enable fast actions"}<span>→</span></button>}
          {state.delegated && <button className="session-action session-action-live" disabled={busy !== null} onClick={() => void runSession("revoke")}>{busy === "revoke" ? "Pausing session…" : "Pause and revoke"}<span>×</span></button>}
          {!publicKey && <p className="session-note">Connect a wallet to activate the match session.</p>}
          {sessionError && <p className="session-error">{sessionError}</p>}
          <div className="trust-row"><span>Local sign</span><span>TxLINE proof</span><span>On-chain settle</span></div>
        </aside>
      </section>

      <footer className="app-footer"><div><Link href="/" className="wordmark">STOPPAGE<span>.</span></Link><span>© 2026</span></div><p>Built on Solana devnet · Match data from TxLINE</p><p className="footer-safety">Use only where permitted. Set limits and take breaks.</p></footer>

      {featuredMarket && <Link className="mobile-market-dock" href={`/markets/${featuredMarket.id}`}><span><i /> {state.delegated ? "Fast on" : "Session setup"}</span><strong>Open bet slip <b>→</b></strong></Link>}
    </main>
  );
}
