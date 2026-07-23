"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ProofPath } from "@/components/ProofPath";
import { MarketWindow } from "@/components/MarketWindow";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import { LiveMatchBar, type MatchPhaseState } from "@/components/LiveMatchBar";
import { ReplayLauncher } from "@/components/ReplayLauncher";
import { SharpMoves } from "@/components/SharpMoves";
import { LazyWhenVisible } from "@/components/LazyWhenVisible";
import { OddsSparkline } from "@/components/OddsSparkline";
import { MatchSignal } from "@/components/MatchSignal";
import { MatchPulse } from "@/components/MatchPulse";
import { MomentAlert } from "@/components/MomentAlert";
import { MatchFixturePicker } from "@/components/MatchFixturePicker";
import { useMatchSignals } from "@/lib/match/useMatchSignals";
import { isFixtureLive, isFixtureScheduled, fixtureStartTimeMs } from "@/lib/match/fixtures";
import { useFixtures, useFixtureScore } from "@/lib/match/useFixtures";
import { useMatchRoomReplay } from "@/lib/replay/useMatchRoomReplay";
import { snapshotIsFresh, type LiveMatchSnapshot } from "@/lib/match/types";

function MatchRoomContent() {
  const searchParams = useSearchParams();
  const { markets } = useMarkets();
  useMyPositions();
  const { publicKey } = useWallet();
  const positions = useStoppageStore((state) => state.positions);
  const feed = useStoppageStore((state) => state.feed);
  const { fixtures } = useFixtures();
  const [replaySnapshot, setReplaySnapshot] = useState<LiveMatchSnapshot | null>(null);
  const replayStatus = useStoppageStore((state) => state.replayStatus);

  const orderedMarkets = useMemo(
    () => Object.values(markets).sort((a, b) => a.closesAt.localeCompare(b.closesAt)),
    [markets]
  );
  const matchIds = useMemo(
    () => [...new Set(orderedMarkets.map((market) => String(market.predicate.matchId)))],
    [orderedMarkets]
  );
  const requestedMatchId = searchParams.get("match");
  const selectedMatchId = requestedMatchId && matchIds.includes(requestedMatchId)
    ? requestedMatchId
    : matchIds[0] ?? null;

  const fixture = useMemo(() => {
    if (selectedMatchId) return fixtures.find((item) => item.matchId === selectedMatchId) ?? null;
    return fixtures.find((item) => isFixtureLive(item)) ?? fixtures[0] ?? null;
  }, [fixtures, selectedMatchId]);

  const live = isFixtureLive(fixture);
  const deadTime = !live && !requestedMatchId;
  const { isReplay, replayable, launching: launchingReplay } = useMatchRoomReplay({
    enabled: deadTime,
    fixtures,
  });
  const polledSnapshot = useFixtureScore(live && fixture ? fixture.FixtureId : null);
  const snapshot = live ? polledSnapshot : replaySnapshot;

  const { signalVersion, lastSignalType, scoringTeam, handleMatchEvent } = useMatchSignals({
    snapshot,
    detect: live,
  });

  const onMatchEvent = useCallback((evt: { type: string; team?: unknown }) => {
    handleMatchEvent(evt);
    if (!live && (evt.type === "corner_awarded" || evt.type === "card_shown")) {
      setReplaySnapshot((prev) => prev ? {
        ...prev,
        stats: {
          corners: prev.stats.corners + (evt.type === "corner_awarded" ? 1 : 0),
          cards: prev.stats.cards + (evt.type === "card_shown" ? 1 : 0),
        },
      } : prev);
    }
  }, [handleMatchEvent, live]);

  const onReplayPhase = useCallback((phase: MatchPhaseState) => {
    setReplaySnapshot((prev) => ({
      updatedAt: Date.now(),
      score: { home: phase.score.home ?? 0, away: phase.score.away ?? 0 },
      stats: prev?.stats ?? { corners: 0, cards: 0 },
    }));
  }, []);

  const matchMarkets = useMemo(
    () => selectedMatchId
      ? orderedMarkets.filter((market) => String(market.predicate.matchId) === selectedMatchId)
      : orderedMarkets,
    [orderedMarkets, selectedMatchId]
  );

  const ownedPositions = useMemo(() => {
    if (!publicKey) return [];
    const marketIds = new Set(matchMarkets.map((market) => market.id));
    return Object.values(positions).filter(
      (position) => position.owner === publicKey.toBase58() && marketIds.has(position.marketId)
    );
  }, [matchMarkets, positions, publicKey]);

  const phase = matchMarkets.find((market) => market.status === "open")?.status ?? matchMarkets[0]?.status ?? "open";

  const matchActivity = useMemo(() => {
    if (!selectedMatchId) return [];
    const seen = new Set<string>();
    return feed
      .filter((event) => event.matchId === selectedMatchId)
      .filter((event) => {
        const key = event.signature ?? event.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }, [feed, selectedMatchId]);

  const fresh = snapshotIsFresh(snapshot);

  const barMatchId = (isReplay && replayStatus?.matchId) ? replayStatus.matchId : selectedMatchId;
  const scoreboardMode = live
    ? fresh ? "live" : "delayed"
    : isReplay
    ? "replay"
    : fixture
    ? "scheduled"
    : "idle";

  return (
    <main className="app-shell">
      <div className="match-room">
        <MatchPulse live={live || isReplay} signalVersion={signalVersion} lastSignalType={lastSignalType} className="match-pulse match-pulse--match" />
        <MomentAlert signalType={lastSignalType} signalVersion={signalVersion} snapshot={snapshot} scoringTeam={scoringTeam} />
        <header className="match-room-header">
          <div>
            <p className="eyebrow">Match</p>
            <h1>{fixture ? `${fixture.Participant1} v ${fixture.Participant2}` : selectedMatchId ? `Match ${selectedMatchId}` : "Live match"}</h1>
          </div>
          <Link href="/markets" className="explorer-back">Markets <span>→</span></Link>
        </header>

        <MatchFixturePicker fixtures={fixtures} matchIds={matchIds} selectedMatchId={selectedMatchId} />

        <section className="control-scoreboard" aria-label="Live match scoreboard">
          <div className="control-scoreboard-top">
            <span className={
              scoreboardMode === "live" ? "match-live"
              : scoreboardMode === "replay" ? "match-replay"
              : scoreboardMode === "scheduled" ? "match-next"
              : "match-next"
            }>
              <i /> {
                scoreboardMode === "live" ? (fresh ? "Live feed" : "Feed delayed")
                : scoreboardMode === "replay" ? (launchingReplay ? "Starting replay…" : "Replay · live pipeline")
                : scoreboardMode === "scheduled" ? "Awaiting kickoff"
                : "No live match right now"
              }
            </span>
            <span>{fixture?.Country ?? (isReplay ? "Replay" : "TxLINE")}</span>
          </div>
          <div className="control-scoreline"><strong>{fixture?.Participant1 ?? "Home"}</strong><b key={snapshot ? `${snapshot.score.home}-${snapshot.score.away}` : "vs"} className={snapshot ? "score-flash" : ""}>{snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</b><strong>{fixture?.Participant2 ?? "Away"}</strong></div>
          <div className="control-stats"><span>{snapshot ? `Corners ${snapshot.stats.corners}` : "Listening"}</span><span>{snapshot ? `Cards ${snapshot.stats.cards}` : live ? "Do not rely on delayed data" : "Listening for the next match"}</span><span>{snapshot?.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Listening for the next match"}</span></div>
          {barMatchId && (
            <LiveMatchBar
              matchId={barMatchId}
              onNewEvent={onMatchEvent}
              onPhase={onReplayPhase}
            />
          )}
          {deadTime && (
            <ReplayLauncher fixtures={replayable} autoMode />
          )}
        </section>

        <MatchSignal markets={matchMarkets} />
        <LazyWhenVisible minHeight={120}>
          <SharpMoves />
        </LazyWhenVisible>

        <section className="match-ownership" aria-label="Your match position">
          <div><p className="eyebrow">Your positions</p><h2>{ownedPositions.length ? `${ownedPositions.length} open ${ownedPositions.length === 1 ? "bet" : "bets"}` : "No bets yet."}</h2></div>
          {ownedPositions.length ? <div className="ownership-list">{ownedPositions.map((position) => <Link href={`/markets/${position.marketId}`} key={position.marketId}><strong>{position.side.toUpperCase()} · {SOL(position.amountLamports)}</strong><span>{position.openedViaSessionKey ? "One-tap" : "Wallet signed"} →</span></Link>)}</div> : <Link className="ownership-action" href={matchMarkets[0] ? `/markets/${matchMarkets[0].id}` : "/markets"}>Place a bet <span>→</span></Link>}
        </section>

        <section className="match-live-reads" aria-labelledby="match-live-reads-title">
          <div className="section-heading"><div><p className="eyebrow">Live markets</p><h2 id="match-live-reads-title">Markets for this match.</h2></div><span>{matchMarkets.length} active</span></div>
          {matchMarkets.length ? <div className="match-market-list">{matchMarkets.map((market) => {
            const odds = impliedProbability(market);
            
            // Determine betting gate state for this market
            let bettingBlocked = false;
            let blockedReason = "";
            if (market.status === "open" && fixture) {
              // Match ended
              if (fixture.GameState > 4) {
                bettingBlocked = true;
                blockedReason = "Match ended";
              }
              // Pre-match: kickoff > 2h away
              else if (isFixtureScheduled(fixture)) {
                const startTime = fixtureStartTimeMs(fixture);
                const hoursUntilKickoff = (startTime - Date.now()) / (1000 * 60 * 60);
                if (hoursUntilKickoff > 2) {
                  bettingBlocked = true;
                  blockedReason = "Opens in 2h";
                }
              }
            } else if (market.status === "open" && !fixture) {
              // No fixture data available
              bettingBlocked = true;
              blockedReason = "Awaiting data";
            }
            
            return <Link className={`match-market-row match-market-${market.status}`} href={`/markets/${market.id}`} key={market.id}><div><span>{market.status.replace("_", " ")}{bettingBlocked && <span className="market-tape-row__blocked" title={blockedReason}>⚠</span>}</span><strong>{formatMarketQuestion(market.predicate)}</strong><small>Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><MarketWindow closesAt={market.closesAt} status={market.status} compact /><div className="match-market-odds"><OddsSparkline marketId={market.id} currentYes={odds.yes} /><b>YES {Math.round(odds.yes * 100)}%</b><b>NO {Math.round(odds.no * 100)}%</b></div><i>→</i></Link>;
          })}</div> : <div className="match-room-empty">Markets will appear here when the match context supports them.</div>}
        </section>

        <div className="match-proof-grid">
          <MatchkeeperStatus updatedAt={snapshot?.updatedAt} marketPhase={phase} events={matchActivity} />
          <ProofPath status={phase} />
        </div>
      </div>
    </main>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={<main className="app-shell" />}>
      <MatchRoomContent />
    </Suspense>
  );
}
