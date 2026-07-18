"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, PREDICATE_LABEL, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSol as SOL } from "@/lib/format";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-32" /> }
);

function marketQuestion(market: Market) {
  const predicate = market.predicate;
  const param = predicate.params.windowSeconds ?? predicate.params.threshold ?? "";
  const team = predicate.params.team ? ` for ${predicate.params.team}` : "";
  return `${PREDICATE_LABEL[predicate.kind] ?? predicate.kind} ${param}${team}`;
}

function MatchState({ fixture }: { fixture: Fixture | null }) {
  if (!fixture) {
    return (
      <div className="match-state match-state-empty">
        <span className="live-dot" />
        <span>Waiting for TxLINE fixture feed</span>
      </div>
    );
  }

  const live = fixture.GameState === 2 || fixture.GameState === 4;
  const start = new Date(fixture.StartTime);
  return (
    <div className="match-state">
      <span className={live ? "live-dot" : "schedule-dot"} />
      <span>{live ? "Live on TxLINE" : start.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      <span className="match-state-divider" />
      <span>{live ? "in-play feed connected" : start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  );
}

function FeaturedMarket({ market }: { market: Market | null }) {
  if (!market) {
    return (
      <div className="featured-market featured-market-empty">
        <p className="eyebrow">Market engine</p>
        <h2>Markets open as the match moves.</h2>
        <p>The autonomous agent is connected to the TxLINE score stream and will publish match-triggered markets here.</p>
        <Link className="quiet-link" href="/markets">See market status</Link>
      </div>
    );
  }

  const odds = impliedProbability(market);
  const pool = market.yesPool + market.noPool;
  return (
    <article className="featured-market">
      <div className="market-kicker">
        <span className="live-label"><span /> Live market</span>
        <span>{SOL(pool)} pool</span>
      </div>
      <h2>{marketQuestion(market)}</h2>
      <p className="market-meta">Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · TxLINE-backed settlement</p>
      <div className="odds-track" aria-label={`Yes ${Math.round(odds.yes * 100)} percent, no ${Math.round(odds.no * 100)} percent`}>
        <div className="odds-yes" style={{ width: `${odds.yes * 100}%` }} />
      </div>
      <div className="odds-labels">
        <span>YES <strong>{Math.round(odds.yes * 100)}%</strong></span>
        <span>NO <strong>{Math.round(odds.no * 100)}%</strong></span>
      </div>
      <Link className="primary-action" href={`/markets/${market.id}`}>Open market <span aria-hidden="true">→</span></Link>
    </article>
  );
}

export default function Home() {
  const { markets } = useMarkets();
  useHeliusMonitor();
  const { publicKey } = useWallet();
  const { state, delegate, revoke } = useSessionKey();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
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

  const featuredMarket = useMemo(
    () => Object.values(markets).find((market) => market.status === "open") ?? null,
    [markets]
  );
  const featuredFixture = useMemo(
    () => fixtures.find((fixture) => fixture.GameState === 2 || fixture.GameState === 4) ?? fixtures[0] ?? null,
    [fixtures]
  );
  const otherMarkets = useMemo(
    () => Object.values(markets).filter((market) => market.id !== featuredMarket?.id).slice(0, 3),
    [markets, featuredMarket]
  );

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

  return (
    <main className="app-shell">
      <header className="app-nav">
        <Link href="/" className="wordmark" aria-label="Stoppage home">STOPPAGE<span>.</span></Link>
        <div className="nav-center"><span className="live-dot" /> World Cup markets</div>
        <div className="nav-wallet"><WalletMultiButton /></div>
      </header>

      <section className="command-center">
        <div className="pitch-atmosphere" aria-hidden="true"><span className="pitch-circle" /><span className="pitch-line" /></div>
        <div className="command-copy page-enter">
          <p className="eyebrow">The match is the market</p>
          <h1>Make your read<br />before the next moment.</h1>
          <p className="lede">Fast, small markets created from the match as it happens. Every resolution is anchored to TxLINE data on Solana.</p>
          <MatchState fixture={featuredFixture} />
        </div>

        <div className="live-stage page-enter page-enter-delay-1">
          <div className="match-board">
            <div className="match-board-top">
              <span>{featuredFixture?.Country ?? "World Cup"}</span>
              <span>{featuredFixture ? `Fixture ${featuredFixture.FixtureId}` : "TxLINE stream"}</span>
            </div>
            <div className="teams-row">
              <div><span className="team-mark">H</span><strong>{featuredFixture?.Participant1 ?? "Next home team"}</strong></div>
              <div className="match-clock">{featuredFixture && (featuredFixture.GameState === 2 || featuredFixture.GameState === 4) ? "LIVE" : "NEXT"}</div>
              <div><strong>{featuredFixture?.Participant2 ?? "Next away team"}</strong><span className="team-mark">A</span></div>
            </div>
            <div className="match-board-foot"><span>Direct feed</span><span>TxLINE signed data</span></div>
          </div>
          <FeaturedMarket market={featuredMarket} />
        </div>
      </section>

      <section className="signal-strip">
        <span><i /> Data stream online</span>
        <span>Markets settle against verifiable score proofs</span>
        <span>Devnet · Solana</span>
      </section>

      <section className="lower-grid">
        <div className="market-rail">
          <div className="section-heading"><div><p className="eyebrow">In play</p><h2>More live reads</h2></div><Link href="/markets">All markets <span>→</span></Link></div>
          {otherMarkets.length > 0 ? (
            <div className="market-list">
              {otherMarkets.map((market) => {
                const odds = impliedProbability(market);
                return <Link className="market-signal" href={`/markets/${market.id}`} key={market.id}><div><span className="market-signal-kind">{PREDICATE_LABEL[market.predicate.kind] ?? market.predicate.kind}</span><strong>{marketQuestion(market)}</strong></div><div className="market-signal-odds"><b>{Math.round(odds.yes * 100)}%</b><span>YES</span></div></Link>;
              })}
            </div>
          ) : <div className="empty-rail">The agent publishes new reads as the feed changes. Keep this tab open during a match.</div>}
        </div>

        <aside className="session-panel">
          <p className="eyebrow">Fast path</p>
          <h2>{state.delegated ? "Session key is ready." : "One approval. Then move."}</h2>
          <p>{state.delegated ? "Your next eligible market action can be signed without another wallet popup." : "Set a bounded session key once, then take eligible market positions without breaking the match."}</p>
          {publicKey && !state.delegated && <button className="session-action" disabled={busy !== null} onClick={() => void runSession("delegate")}>{busy === "delegate" ? "Preparing session…" : "Enable fast actions"}</button>}
          {state.delegated && <button className="session-action session-action-live" disabled={busy !== null} onClick={() => void runSession("revoke")}>{busy === "revoke" ? "Stopping session…" : "Session active · manage"}</button>}
          {!publicKey && <p className="session-note">Connect a wallet to enable the match session.</p>}
          {sessionError && <p className="session-error">{sessionError}</p>}
          <div className="trust-row"><span>TxLINE proof gate</span><span>On-chain settlement</span></div>
        </aside>
      </section>

      <footer className="app-footer">
        <div><Link href="/" className="wordmark">STOPPAGE<span>.</span></Link><span>© 2026</span></div>
        <p>Built on Solana devnet · Match data from TxLINE</p>
        <p className="footer-safety">Use only where permitted. Set limits and take breaks.</p>
      </footer>

      {featuredMarket && (
        <Link className="mobile-market-dock" href={`/markets/${featuredMarket.id}`}>
          <span><i /> Live market</span>
          <strong>Make your call <b>→</b></strong>
        </Link>
      )}
    </main>
  );
}
