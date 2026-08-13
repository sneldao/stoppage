"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSigningSpeed, formatMarketQuestion, formatSol as SOL } from "@/lib/format";
import { useStoppageStore } from "@/store";
import { SetupPrompt } from "@/components/SetupPrompt";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { LiveInstrument, type PreviewBeatHandler } from "@/components/LiveInstrument";
import { MomentAlert } from "@/components/MomentAlert";
import { SharpMoves } from "@/components/SharpMoves";
import { LazyWhenVisible } from "@/components/LazyWhenVisible";
import { MatchPulse } from "@/components/MatchPulse";
import { OpenPositionsBanner } from "@/components/OpenPositionsBanner";
import { RightNowLine } from "@/components/RightNowLine";
import { PersonalizedHero, usePrimaryOpenPosition } from "@/components/PersonalizedHero";
import { StreakCelebration } from "@/components/StreakCelebration";
import { Achievements } from "@/components/Achievements";
import { KeystoneBanner } from "@/components/KeystoneBanner";
import { useAutoReplay } from "@/lib/replay/useAutoReplay";
import { usePreviewLoop } from "@/lib/replay/usePreviewLoop";
import { useMatchSignals } from "@/lib/match/useMatchSignals";
import { isFixtureLive, isFixtureScheduled, fixtureStartTimeMs, listReplayableFixtures } from "@/lib/match/fixtures";
import { useAttestHero } from "@/lib/match/useAttestHero";
import { useFixtures, useFixtureScore } from "@/lib/match/useFixtures";
import type { LiveMatchSnapshot } from "@/lib/match/types";

const StoppageClock = dynamic(
  () => import("@/components/StoppageClock").then((m) => m.StoppageClock),
  { ssr: false }
);

const SpinningGrooves = dynamic(
  () => import("@/components/SpinningGrooves").then((m) => m.SpinningGrooves),
  { ssr: false }
);

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
  const { publicKey } = useWallet();
  const { state } = useSessionKey();
  const lastSigningMs = useStoppageStore((s) => s.lastSigningMs);
  const marketsLoading = useStoppageStore((s) => s.marketsLoading);
  const positions = useStoppageStore((s) => s.positions);
  const history = useStoppageStore((s) => s.history);

  const { fixtures } = useFixtures();
  const [overrideSnapshot, setOverrideSnapshot] = useState<LiveMatchSnapshot | null>(null);
  // Counters for the replay scoreline (corner/card stats come from events,
  // not the SSE phase, so we accumulate them as events stream in).
  const replayStatsRef = useRef({ corners: 0, cards: 0 });

  // A TxLINE fixture is in play.
  const txlineHasLive = useMemo(() => fixtures.some((f) => isFixtureLive(f)), [fixtures]);

  // The operator-attested plane (TheSportsDB): the real upcoming/live big game
  // (e.g. Orlando City vs FC Cincinnati, the Saturday attestation keystone).
  // `fixture` is synthetic (GameState 1 = scheduled countdown, 2 = in play);
  // `snapshot` carries the real scoreline once it's live.
  const { fixture: attestFixture, snapshot: attestSnapshot, inPlay: attestInPlay } = useAttestHero();

  // Pause the auto-replay reel whenever the big game is on the air (a real
  // live proof-gated settle beats a replay; you don't want to swap the hero
  // away mid-match).
  const hasLive = txlineHasLive || attestInPlay;

  // Dead time → auto-rotate finished replays through the live pipeline.
  const { status: replayStatus, isReplay, launch: launchReplay, launching: launchingReplay, error: replayError } = useAutoReplay({
    hasLive,
    fixtures,
    preferTeams: ["france", "spain"],
  });

  // Nearest real upcoming TxLINE fixture (scheduled, not yet kicked off).
  // Prefer free-bundle league matches (MLS / EPL) for the hero countdown.
  // Competition.MLS=33 / Competition.PremierLeague=8 — literals avoid pulling
  // @stoppage/txline's node-only credentials barrel into the client.
  const txlineUpcoming = useMemo(() => {
    const now = Date.now();
    const scheduled = fixtures
      .filter((f) => isFixtureScheduled(f) && fixtureStartTimeMs(f) > now)
      .sort((a, b) => fixtureStartTimeMs(a) - fixtureStartTimeMs(b));
    const league = scheduled.find(
      (f) => f.CompetitionId === 33 || f.CompetitionId === 8
    );
    return league ?? scheduled[0] ?? null;
  }, [fixtures]);

  // Next big game: TxLINE league fixtures win when present; attestation
  // plane remains the fallback for open tsdb:* markets this weekend.
  const nextUpcoming = txlineUpcoming ?? attestFixture;

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
  // active replay, not launching one) AND there's no real scheduled match to
  // count down to, drive the hero from a canned, looping script so the
  // scoreboard ticks and goal drama fires with zero external input. If a real
  // upcoming fixture exists, we prefer its live countdown instead (see
  // `nextUpcoming`). Badged honestly as PREVIEW by LiveInstrument.
  const isPreview =
    !hasLive && !isReplay && !launchingReplay && !nextUpcoming;

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

  const heroFixture = isPreview
    ? null
    : isReplay && replayFixture
    ? replayFixture
    : !txlineHasLive && nextUpcoming
    ? nextUpcoming
    : featuredFixture;

  const polledSnapshot = useFixtureScore(
    isReplay || isPreview || !featuredFixture || !isFixtureLive(featuredFixture)
      ? null
      : featuredFixture.FixtureId
  );

  // When the operator-attested big game is live and no TxLINE match is on,
  // the hero reads the real score from the attestation plane instead of the
  // TxLINE poll (which has no fixture for "tsdb:*" matches).
  const attestIsLive = !isReplay && !isPreview && !txlineHasLive && attestSnapshot != null;
  const liveSnapshot = isReplay || isPreview
    ? overrideSnapshot
    : attestIsLive
    ? attestSnapshot
    : polledSnapshot;

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

  // The scripted preview loop mirrors its goal/corner/card beats into the
  // instrument's event ticker (registered from within LiveInstrument).
  const previewBeatRef = useRef<PreviewBeatHandler | null>(null);
  const registerPreviewBeat = useCallback((cb: PreviewBeatHandler | null) => {
    previewBeatRef.current = cb;
  }, []);
  const handlePreviewBeat = useCallback((kind: "goal" | "corner" | "card", team: string | null) => {
    previewBeatRef.current?.(kind, team);
  }, []);

  const { previewFixture } = usePreviewLoop({
    active: isPreview,
    setSnapshot: setOverrideSnapshot as (s: LiveMatchSnapshot | null) => void,
    setLastSignalType,
    setSignalVersion,
    setScoringTeam,
    onBeat: handlePreviewBeat,
  });

  const resolvedHeroFixture = isPreview ? previewFixture : heroFixture;
  const otherMarkets = useMemo(
    () => Object.values(markets).filter((m) => m.id !== featuredMarket?.id).slice(0, 3),
    [markets, featuredMarket],
  );

  // Lift the replay's SSE phase into the hero snapshot. Score comes from
  // phase; corners/cards are accumulated from the event stream (the phase
  // payload doesn't carry stats).
  const onReplayPhase = useCallback((phase: { score: { home: number; away: number } }) => {
    setOverrideSnapshot({
      updatedAt: Date.now(),
      score: { home: phase.score.home ?? 0, away: phase.score.away ?? 0 },
      stats: { ...replayStatsRef.current },
    });
  }, []);

  const handleNewEvent = useCallback((evt: any) => {
    handleMatchEvent(evt);
    // Accumulate replay stats as events stream in.
    if (evt.type === "corner_awarded") replayStatsRef.current = { ...replayStatsRef.current, corners: replayStatsRef.current.corners + 1 };
    if (evt.type === "card_shown" || evt.type === "yellow_card" || evt.type === "red_card") replayStatsRef.current = { ...replayStatsRef.current, cards: replayStatsRef.current.cards + 1 };
  }, [handleMatchEvent]);

  const marketHref = featuredMarket ? `/markets/${featuredMarket.id}` : "/markets";

  return (
    <main className="app-shell">

      {/* ── Live moment alert overlay ──
          Suppressed entirely in preview: a scripted goal firing the
          full-bleed "Live update" overlay reads as crying wolf. The
          in-card scoreline flash + event ticker keep the demo lively
          without impersonating a live feed; the overlay regains its
          meaning the moment real data is flowing. */}
      <MomentAlert
        signalType={isPreview ? null : lastSignalType}
        signalVersion={signalVersion}
        snapshot={liveSnapshot}
        scoringTeam={scoringTeam}
        onDismiss={() => setLastSignalType(null)}
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
                Pick a live football outcome and stake devnet SOL. Your payout
                only moves when the result&apos;s proof verifies on-chain — no
                admin key, no committee vote.
              </p>
              <RightNowLine />
              <SetupPrompt marketHref={marketHref} />
            </>
          )}
          <OpenPositionsBanner />
          <KeystoneBanner compact />
          {state.delegated && lastSigningMs !== null && (
            <p className="hero-speed-note">
              <i className="live-dot" /> Last bet {formatSigningSpeed(lastSigningMs)}
            </p>
          )}
        </div>

        {/* Centre: single live instrument (match ↔ market) */}
        <div className="live-stage" id="live-stage">
          <LiveInstrument
            fixture={resolvedHeroFixture}
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
            onPreviewBeat={registerPreviewBeat}
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
                  const currentId = replayStatus?.fixtureId;
                  const blocked = new Set(useStoppageStore.getState().replayBlockedFixtureIds);
                  const next = listReplayableFixtures(fixtures, blocked)
                    .find((f) => f.FixtureId !== currentId);
                  if (next) void launchReplay(next.FixtureId);
                }}
              >
                Switch match →
              </button>
            </div>
          )}
          {isPreview && (
            <div className="replay-control-strip">
              <span className="replay-control-status">
                Demo reel · scripted scenarios (no live feed
                {replayError ? ` — ${replayError}` : ""})
              </span>
            </div>
          )}
        </div>

        {/* Right side: grooves + public market activity always visible;
            personal achievements gated behind wallet connect. */}
        <div className="hero-sidecar">
          <div className="hero-grooves" aria-hidden="true">
            <SpinningGrooves size={520} rings={6} color="var(--blue)" counterRotate speed={0.7} />
          </div>
          <LazyWhenVisible minHeight={120}>
            <SharpMoves />
          </LazyWhenVisible>
          <HeroMarketRail markets={otherMarkets} />
          {publicKey && (
            <Achievements history={history} positions={positions} />
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
        <p>Built on Solana devnet · Match data from TxLINE · Pyth prices · operator attestation (reference oracle)</p>
        <p>One settlement contract, three live proof paths: TxLINE sports, Pyth prices, operator attestation. <Link href="/operators">Built for operators →</Link></p>
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
