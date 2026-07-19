"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSigningSpeed, formatMarketQuestion, formatSol as SOL } from "@/lib/format";
import { useStoppageStore } from "@/store";
import { SetupPrompt } from "@/components/SetupPrompt";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { LiveInstrument } from "@/components/LiveInstrument";
import { StoppageClock } from "@/components/StoppageClock";
import { SharpMoves } from "@/components/SharpMoves";
import { MatchPulse } from "@/components/MatchPulse";
import { OpenPositionsBanner } from "@/components/OpenPositionsBanner";
import { RightNowLine } from "@/components/RightNowLine";
import { useAutoReplay, type ReplayStatus } from "@/lib/replay/useAutoReplay";

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
  const marketsLoading = useStoppageStore((s) => s.marketsLoading);
  const positions = useStoppageStore((s) => s.positions);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMatchSnapshot | null>(null);
  const [signalVersion, setSignalVersion] = useState(0);
  const [lastSignalType, setLastSignalType] = useState<"goal" | "corner" | "card" | null>(null);
  const [scoringTeam, setScoringTeam] = useState<string | null>(null);
  const previousSignal = useRef<string | null>(null);
  // Counters for the replay scoreline (corner/card stats come from events,
  // not the SSE phase, so we accumulate them as events stream in).
  const replayStatsRef = useRef({ corners: 0, cards: 0 });

  // Fetch fixtures once on mount
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Fixture feed unavailable"))))
      .then((data) => { if (!cancelled) setFixtures(data.fixtures ?? []); })
      .catch(() => { if (!cancelled) setFixtures([]); });
    return () => { cancelled = true; };
  }, []);

  const hasLive = useMemo(() => fixtures.some((f) => isLive(f)), [fixtures]);
  // Dead time → auto-run a featured replay through the live pipeline.
  const { status: replayStatus, isReplay, launch: launchReplay, launching: launchingReplay } = useAutoReplay({
    hasLive,
    fixtures,
    preferTeams: ["france", "spain"],
  });

  // Build a synthetic fixture for the replay so LiveInstrument's match face
  // has teams + a live GameState to drive the scoreline.
  const replayFixture = useMemo<Fixture | null>(() => {
    if (!replayStatus?.active || !replayStatus.matchId) return null;
    return {
      FixtureId: replayStatus.fixtureId ?? 0,
      Participant1: replayStatus.homeTeam ?? "Home",
      Participant2: replayStatus.awayTeam ?? "Away",
      Country: "Replay",
      GameState: 3, // finished — we drive "live" via the `replay` prop, not GameState
      StartTime: replayStatus.startedAt ? new Date(replayStatus.startedAt).toISOString() : new Date().toISOString(),
      matchId: replayStatus.matchId,
    } as unknown as Fixture;
  }, [replayStatus]);

  const replayMatchId = replayStatus?.active ? replayStatus.matchId : undefined;

  // Reset replay stat counters when a new replay match begins.
  useEffect(() => {
    replayStatsRef.current = { corners: 0, cards: 0 };
  }, [replayMatchId]);

  const featuredMarket = useMemo(
    () => Object.values(markets).find((m) => m.status === "open") ?? null,
    [markets],
  );
  const featuredFixture = useMemo(
    () => fixtures.find((f) => isLive(f)) ?? fixtures[0] ?? null,
    [fixtures],
  );
  // During a replay the hero shows the replay match; otherwise the live/next fixture.
  const heroFixture = isReplay && replayFixture ? replayFixture : featuredFixture;
  const otherMarkets = useMemo(
    () => Object.values(markets).filter((m) => m.id !== featuredMarket?.id).slice(0, 3),
    [markets, featuredMarket],
  );

  // Poll live score when a real match is live (skipped during replay — the
  // SSE phase drives the snapshot there).
  useEffect(() => {
    if (isReplay) return;
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

  // Detect score/stat changes → fire signal animations. Skipped during
  // replay, where events drive signals directly (more responsive than
  // polling the snapshot diff).
  useEffect(() => {
    if (isReplay) { previousSignal.current = null; return; }
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
  }, [liveSnapshot, isReplay]);

  // Auto-clear alert badge
  useEffect(() => {
    if (!lastSignalType) return;
    const t = setTimeout(() => setLastSignalType(null), 5_000);
    return () => clearTimeout(t);
  }, [lastSignalType]);

  // Lift the replay's SSE phase into the hero snapshot. Score comes from
  // phase; corners/cards are accumulated from the event stream (the phase
  // payload doesn't carry stats).
  const onReplayPhase = useCallback((phase: { score: { home: number; away: number } }) => {
    setLiveSnapshot({
      updatedAt: Date.now(),
      score: { home: phase.score.home ?? 0, away: phase.score.away ?? 0 },
      stats: { ...replayStatsRef.current },
    });
  }, []);

  const handleNewEvent = (evt: any) => {
    const map: Record<string, "goal" | "card" | "corner"> = {
      goal_scored: "goal", own_goal: "goal",
      card_shown: "card", corner_awarded: "corner",
    };
    const type = map[evt.type as string];
    if (type) { setLastSignalType(type); setSignalVersion((v) => v + 1); }
    if (evt.team) setScoringTeam(String(evt.team));
    // Accumulate replay stats as events stream in.
    if (evt.type === "corner_awarded") replayStatsRef.current = { ...replayStatsRef.current, corners: replayStatsRef.current.corners + 1 };
    if (evt.type === "card_shown" || evt.type === "yellow_card" || evt.type === "red_card") replayStatsRef.current = { ...replayStatsRef.current, cards: replayStatsRef.current.cards + 1 };
  };

  const marketHref = featuredMarket ? `/markets/${featuredMarket.id}` : "/markets";

  return (
    <main className="app-shell">

      {/* ── Live moment alert overlay ── */}
      {lastSignalType && (
        <>
          {/* Full-bleed edge-glow flash in the signal colour */}
          <div key={signalVersion} className={`moment-flash moment-flash--${lastSignalType}`} aria-hidden="true" />
          <div className={`moment-alert moment-alert--${lastSignalType}`} role="alert" aria-live="assertive">
            <div className="moment-alert-content">
              <span className="moment-alert-badge">⚡ Live update</span>
              <h2>
                {lastSignalType === "goal" && (scoringTeam ? `GOAL — ${scoringTeam} ⚽` : "GOAL SCORED! ⚽")}
                {lastSignalType === "card" && "CARD ISSUED! 🟨"}
                {lastSignalType === "corner" && "CORNER KICK! 🚩"}
              </h2>
              <p>
                {lastSignalType === "goal" && liveSnapshot ? `Score ${liveSnapshot.score.home} — ${liveSnapshot.score.away}` : null}
                {lastSignalType === "card" && liveSnapshot ? `Total cards: ${liveSnapshot.stats.cards}` : null}
                {lastSignalType === "corner" && liveSnapshot ? `Total corners: ${liveSnapshot.stats.corners}` : null}
              </p>
              {/* Your-position line — if you have a stake on the featured market */}
              {lastSignalType === "goal" && publicKey && featuredMarket && (() => {
                const pos = positions[`${featuredMarket.id}:${publicKey.toBase58()}`];
                if (!pos || pos.amountLamports <= 0) return null;
                const odds = impliedProbability(featuredMarket)[pos.side];
                const yourPool = pos.side === "yes" ? featuredMarket.yesPool : featuredMarket.noPool;
                const oppPool = pos.side === "yes" ? featuredMarket.noPool : featuredMarket.yesPool;
                const payout = yourPool > 0 ? pos.amountLamports + Math.floor((pos.amountLamports * oppPool) / yourPool) : pos.amountLamports;
                return (
                  <p className="moment-alert-position">
                    Your {pos.side.toUpperCase()} is now {Math.round(odds * 100)}% · if it wins {SOL(payout)}
                  </p>
                );
              })()}
              <div className="moment-alert-loading" />
            </div>
          </div>
        </>
      )}

      {/* ── Command centre ── */}
      <section className="command-center">
        <MatchPulse live={isLive(featuredFixture)} signalVersion={signalVersion} lastSignalType={lastSignalType} />

        <div className="hero-clock" aria-hidden="true">
          <StoppageClock size={560} globalPointer />
        </div>

        {/* Left column: copy + CTA */}
        <div className="command-copy">
          <h1>Bet on what happens next.</h1>
          <p className="lede">
            Choose a live football outcome, stake devnet SOL, and watch the
            result verify automatically.
          </p>
          <RightNowLine />
          <SetupPrompt marketHref={marketHref} />
          <OpenPositionsBanner />
          {state.delegated && lastSigningMs !== null && (
            <p className="hero-speed-note">
              <i className="live-dot" /> Last bet {formatSigningSpeed(lastSigningMs)}
            </p>
          )}
          {!publicKey && (
            <p className="hero-watch-hint">
              <a href="#live-stage">↓ Watch the live demo below</a>
            </p>
          )}
        </div>

        {/* Centre: single live instrument (match ↔ market) */}
        <div className="live-stage" id="live-stage">
          <LiveInstrument
            fixture={heroFixture}
            snapshot={liveSnapshot}
            market={featuredMarket}
            marketsLoading={marketsLoading}
            matchId={replayMatchId}
            replay={isReplay}
            onPhase={onReplayPhase}
            signalVersion={signalVersion}
            lastSignalType={lastSignalType}
            allFixtures={fixtures}
            onNewEvent={handleNewEvent}
          />
          {isReplay && (
            <div className="replay-control-strip">
              <span className="replay-control-status">
                {launchingReplay ? "Starting replay…" : replayStatus?.finished ? "Replay settling…" : "Replay running · live pipeline"}
              </span>
              <button
                type="button"
                className="replay-control-switch"
                disabled={launchingReplay}
                onClick={() => {
                  // Pick the next-most-recent completed fixture that isn't the current replay.
                  const currentId = replayStatus?.fixtureId;
                  const completed = fixtures
                    .filter((f) => { const s = f.GameState as unknown; return s !== 1 && s !== 2 && s !== 4; })
                    .filter((f) => f.FixtureId !== currentId)
                    .sort((a, b) => {
                      const ta = typeof a.StartTime === "string" ? new Date(a.StartTime).getTime() : (a.StartTime as unknown as number) * 1000;
                      const tb = typeof b.StartTime === "string" ? new Date(b.StartTime).getTime() : (b.StartTime as unknown as number) * 1000;
                      return tb - ta;
                    });
                  if (completed[0]) void launchReplay(completed[0].FixtureId);
                }}
              >
                Switch match →
              </button>
            </div>
          )}
        </div>

        {/* Right sidecar: sharp signals + additional markets — only after connect */}
        {publicKey && (
          <div className="hero-sidecar">
            <SharpMoves />
            <HeroMarketRail markets={otherMarkets} />
          </div>
        )}
      </section>

      {/* ── Matchkeeper compact badge — only after connect ── */}
      {publicKey && (
        <div className="keeper-strip" aria-label="Agent status">
          <MatchkeeperStatus
            updatedAt={liveSnapshot?.updatedAt}
            marketPhase={featuredMarket?.status}
            compact
          />
        </div>
      )}

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
          <strong>Place your first bet <b>→</b></strong>
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
