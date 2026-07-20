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
import { MomentAlert } from "@/components/MomentAlert";
import { StoppageClock } from "@/components/StoppageClock";
import { SharpMoves } from "@/components/SharpMoves";
import { MatchPulse } from "@/components/MatchPulse";
import { OpenPositionsBanner } from "@/components/OpenPositionsBanner";
import { RightNowLine } from "@/components/RightNowLine";
import { PersonalizedHero, usePrimaryOpenPosition } from "@/components/PersonalizedHero";
import { StreakCelebration } from "@/components/StreakCelebration";
import { Achievements } from "@/components/Achievements";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { useAutoReplay, type ReplayStatus } from "@/lib/replay/useAutoReplay";
import { usePreviewLoop } from "@/lib/replay/usePreviewLoop";
import { useMatchSignals } from "@/lib/match/useMatchSignals";
import { isFixtureLive } from "@/lib/match/fixtures";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

type FixtureWithMatchId = Fixture & { matchId: string };

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
  const history = useStoppageStore((s) => s.history);

  const [fixtures, setFixtures] = useState<FixtureWithMatchId[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveMatchSnapshot | null>(null);
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

  const hasLive = useMemo(() => fixtures.some((f) => isFixtureLive(f)), [fixtures]);
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

  // Non-contingent baseline: when nothing is flowing (no live fixture, no
  // active replay, not launching one), drive the hero from a canned,
  // looping script so the scoreboard ticks and goal drama fires with zero
  // external input. Badged honestly as PREVIEW by LiveInstrument.
  const isPreview = !hasLive && !isReplay && !launchingReplay;

  // Detect score/stat changes → fire signal animations. Detection is
  // suspended during replay (events drive signals directly) and preview
  // (the loop drives signals directly).
  const {
    signalVersion,
    lastSignalType,
    scoringTeam,
    setSignalVersion,
    setLastSignalType,
    setScoringTeam,
    handleMatchEvent,
  } = useMatchSignals({ snapshot: liveSnapshot, detect: !isReplay && !isPreview });

  const { previewFixture } = usePreviewLoop({
    active: isPreview,
    setSnapshot: setLiveSnapshot as (s: LiveMatchSnapshot | null) => void,
    setLastSignalType,
    setSignalVersion,
    setScoringTeam,
  });

  const { market: primaryMarket, position: primaryPosition } = usePrimaryOpenPosition(markets, positions);

  const featuredMarket = useMemo(() => {
    if (primaryMarket) return primaryMarket;
    return Object.values(markets).find((m) => m.status === "open") ?? null;
  }, [markets, primaryMarket]);

  const featuredFixture = useMemo(() => {
    if (primaryMarket) {
      const matchId = String(primaryMarket.predicate.matchId);
      const matchFixture = fixtures.find((f) => String(f.matchId) === matchId);
      return matchFixture ?? fixtures.find((f) => isFixtureLive(f)) ?? fixtures[0] ?? null;
    }
    return fixtures.find((f) => isFixtureLive(f)) ?? fixtures[0] ?? null;
  }, [fixtures, primaryMarket]);
  // During a replay the hero shows the replay match; during preview the
  // synthetic preview fixture; otherwise the live/next fixture.
  const heroFixture = isPreview ? previewFixture : (isReplay && replayFixture ? replayFixture : featuredFixture);
  const otherMarkets = useMemo(
    () => Object.values(markets).filter((m) => m.id !== featuredMarket?.id).slice(0, 3),
    [markets, featuredMarket],
  );

  // Poll live score when a real match is live (skipped during replay and
  // preview — the SSE phase / preview loop drives the snapshot there).
  useEffect(() => {
    if (isReplay || isPreview) return;
    if (!featuredFixture || !isFixtureLive(featuredFixture)) {
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
    handleMatchEvent(evt);
    // Accumulate replay stats as events stream in.
    if (evt.type === "corner_awarded") replayStatsRef.current = { ...replayStatsRef.current, corners: replayStatsRef.current.corners + 1 };
    if (evt.type === "card_shown" || evt.type === "yellow_card" || evt.type === "red_card") replayStatsRef.current = { ...replayStatsRef.current, cards: replayStatsRef.current.cards + 1 };
  };

  const marketHref = featuredMarket ? `/markets/${featuredMarket.id}` : "/markets";

  return (
    <main className="app-shell">

      {/* ── Live moment alert overlay ── */}
      <MomentAlert
        signalType={lastSignalType}
        signalVersion={signalVersion}
        snapshot={liveSnapshot}
        scoringTeam={scoringTeam}
      >
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
      </MomentAlert>

      {/* ── Streak celebration — global milestone moment ── */}
      <StreakCelebration history={history} />

      {/* ── Command centre ── */}
      <section className="command-center">
        <MatchPulse live={isFixtureLive(featuredFixture)} signalVersion={signalVersion} lastSignalType={lastSignalType} />

        <div className="hero-clock" aria-hidden="true">
          <StoppageClock size={560} globalPointer />
        </div>

        {/* Left column: copy + CTA */}
        <div className="command-copy">
          {primaryPosition && primaryMarket ? (
            <PersonalizedHero
              markets={markets}
              positions={positions}
              history={history}
              fixtures={fixtures}
              primaryMarket={primaryMarket}
              primaryPosition={primaryPosition}
            />
          ) : (
            <>
              <h1>Bet on what happens next.</h1>
              <p className="lede">
                Choose a live football outcome, stake devnet SOL, and watch the
                result verify automatically.
              </p>
              <RightNowLine />
              <SetupPrompt marketHref={marketHref} />
            </>
          )}
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
            preview={isPreview}
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
          {isPreview && (
            <div className="replay-control-strip">
              <span className="replay-control-status">
                Preview mode · no live feed — showing a canned demo
              </span>
            </div>
          )}
        </div>

        {/* Right side: grooves always visible; sidecar content only after connect */}
        <div className="hero-sidecar">
          <div className="hero-grooves" aria-hidden="true">
            <SpinningGrooves size={520} rings={6} color="var(--blue)" counterRotate speed={0.7} />
          </div>
          {publicKey && (
            <>
              <Achievements history={history} positions={positions} />
              <SharpMoves />
              <HeroMarketRail markets={otherMarkets} />
            </>
          )}
        </div>
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
