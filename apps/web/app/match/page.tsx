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
import { OddsSparkline } from "@/components/OddsSparkline";
import { MatchSignal } from "@/components/MatchSignal";
import { MatchPulse } from "@/components/MatchPulse";
import { MomentAlert } from "@/components/MomentAlert";
import { MatchFixturePicker } from "@/components/MatchFixturePicker";
import { useMatchSignals } from "@/lib/match/useMatchSignals";
import { isFixtureLive, isFixtureScheduled, fixtureStartTimeMs } from "@/lib/match/fixtures";
import { useFixtures, useFixtureScore } from "@/lib/match/useFixtures";
import { useAttestEvent } from "@/lib/match/useAttestEvent";
import { useAttestEvents } from "@/lib/match/useAttestEvents";
import { isAttestMatchId } from "@/lib/match/attest";
import { isFixtureGatedMarket } from "@/lib/match/useBettingGate";
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

  // Operator-attested plane: matches like "tsdb:2406978" (the Orlando City
  // vs FC Cincinnati keystone) have no TxLINE fixture — labels come from
  // the tsdb event list.
  const attestList = useAttestEvents();

  const requestedMatchId = searchParams.get("match");
  // Selection: an explicit ?match= wins; otherwise the first match with
  // real context (TxLINE fixture or attested event), live ones first.
  // Price-feed and custom /launch markets never auto-focus the room —
  // their raw ids ("SOL/USD:<ts>", "DEMO-…") used to drown it.
  const selectedMatchId = useMemo(() => {
    if (requestedMatchId && matchIds.includes(requestedMatchId)) return requestedMatchId;
    const contextIds = matchIds.filter(
      (id) => fixtures.some((f) => f.matchId === id) || attestList.byMatchId.has(id)
    );
    const liveId = contextIds.find((id) => {
      const f = fixtures.find((fx) => fx.matchId === id);
      return (f && isFixtureLive(f)) || (attestList.byMatchId.get(id)?.inPlay ?? false);
    });
    return liveId ?? contextIds[0] ?? null;
  }, [requestedMatchId, matchIds, fixtures, attestList.byMatchId]);

  const fixture = useMemo(() => {
    if (selectedMatchId) return fixtures.find((item) => item.matchId === selectedMatchId) ?? null;
    return fixtures.find((item) => isFixtureLive(item)) ?? fixtures[0] ?? null;
  }, [fixtures, selectedMatchId]);

  const attest = useAttestEvent(selectedMatchId);
  const attestFixture = attest?.fixture ?? null;
  const attestInPlay = attest?.inPlay ?? false;
  const attestSnapshot = attest?.snapshot ?? null;

  const live = isFixtureLive(fixture) || attestInPlay;
  // Only auto-replay when there's genuinely no match context to focus — a
  // scheduled (or live) real match shows its own board, not a replay.
  const deadTime = !live && !fixture && !attestFixture && !requestedMatchId;
  const { isReplay, launching: launchingReplay } = useMatchRoomReplay({
    enabled: deadTime,
    fixtures,
  });
  const polledSnapshot = useFixtureScore(live && fixture ? fixture.FixtureId : null);
  const snapshot = live ? (attestSnapshot ?? polledSnapshot) : replaySnapshot;

  const { signalVersion, lastSignalType, scoringTeam, handleMatchEvent, setLastSignalType } = useMatchSignals({
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
      : [],
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

  // The match the scoreboard is actually showing: a TxLINE fixture or an
  // operator-attested (tsdb) synthetic one.
  const effectiveFixture = fixture ?? attestFixture;

  // Operator-attested matches have no TxLINE SSE stream, and price-feed /
  // custom markets never carry match events — only render the live bar for
  // a matchId the TxLINE fixture plane actually knows about (or a replay).
  const barMatchId = (isReplay && replayStatus?.matchId)
    ? replayStatus.matchId
    : selectedMatchId && fixtures.some((f) => f.matchId === selectedMatchId)
    ? selectedMatchId
    : undefined;
  const scoreboardMode = live
    ? fresh ? "live" : "delayed"
    : isReplay
    ? "replay"
    : effectiveFixture
    ? "scheduled"
    : "idle";

  return (
    <main className="app-shell">
      <div className="match-room">
        <MatchPulse live={live || isReplay} signalVersion={signalVersion} lastSignalType={lastSignalType} className="match-pulse match-pulse--match" />
        {/* Same honesty rule as the home hero: the full-bleed overlay is for
            real live signals. During replays the score flash + badged event
            ticker keep the room lively without impersonating a live feed. */}
        <MomentAlert
          signalType={isReplay ? null : lastSignalType}
          signalVersion={signalVersion}
          snapshot={snapshot}
          scoringTeam={scoringTeam}
          onDismiss={() => setLastSignalType(null)}
        />
        <header className="match-room-header">
          <div>
            <p className="eyebrow">Match room</p>
            {/* Never dump a raw market/feed id here — price and custom markets
                live behind the picker's summary link instead. */}
            <h1>{effectiveFixture ? `${effectiveFixture.Participant1} v ${effectiveFixture.Participant2}` : "Waiting for the next match"}</h1>
          </div>
          <Link href="/markets" className="explorer-back">Markets <span>→</span></Link>
        </header>

        <MatchFixturePicker fixtures={fixtures} matchIds={matchIds} selectedMatchId={selectedMatchId} attestByMatchId={attestList.byMatchId} />

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
            <span>{isAttestMatchId(selectedMatchId) ? "TheSportsDB · operator-attested · not TxODDS-verified" : (fixture?.Country ?? (isReplay ? "Replay" : "TxLINE"))}</span>
          </div>
          {effectiveFixture || snapshot ? (
            <>
              <div className="control-scoreline"><strong>{effectiveFixture?.Participant1 ?? "Home"}</strong><b key={snapshot ? `${snapshot.score.home}-${snapshot.score.away}` : "vs"} className={snapshot ? "score-flash" : ""}>{snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</b><strong>{effectiveFixture?.Participant2 ?? "Away"}</strong></div>
              {(snapshot || live) && (
                <div className="control-stats">
                  {snapshot ? <span>Corners {snapshot.stats.corners} · Cards {snapshot.stats.cards}</span> : <span>Awaiting first feed update</span>}
                  {snapshot?.updatedAt && <span>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
                  {live && !fresh && <span>Do not rely on delayed data</span>}
                </div>
              )}
            </>
          ) : (
            <p className="control-scoreboard-idle">Pick a match above, or wait for the keeper to spot one — the scoreboard fills in when a fixture lands.</p>
          )}
          {barMatchId && (
            <LiveMatchBar
              matchId={barMatchId}
              onNewEvent={onMatchEvent}
              onPhase={onReplayPhase}
            />
          )}
          {deadTime && <ReplayLauncher />}
        </section>

        <MatchSignal markets={matchMarkets} />

        {/* Positions only make sense once a wallet is connected — hide the
            whole block (not just the list) until then. */}
        {publicKey && (
          <section className="match-ownership" aria-label="Your match position">
            <div><p className="eyebrow">Your positions</p><h2>{ownedPositions.length ? `${ownedPositions.length} open ${ownedPositions.length === 1 ? "bet" : "bets"}` : "No bets yet."}</h2></div>
            {ownedPositions.length ? <div className="ownership-list">{ownedPositions.map((position) => <Link href={`/markets/${position.marketId}`} key={position.marketId}><strong>{position.side.toUpperCase()} · {SOL(position.amountLamports)}</strong><span>{position.openedViaSessionKey ? "One-tap" : "Wallet signed"} →</span></Link>)}</div> : <Link className="ownership-action" href={matchMarkets[0] ? `/markets/${matchMarkets[0].id}` : "/markets"}>Place a bet <span>→</span></Link>}
          </section>
        )}

        <section className="match-live-reads" aria-labelledby="match-live-reads-title">
          <div className="section-heading"><div><p className="eyebrow">Live markets</p><h2 id="match-live-reads-title">Markets for this match.</h2></div><span>{matchMarkets.length} active</span></div>
          {matchMarkets.length ? <div className="match-market-list">{matchMarkets.map((market) => {
            const odds = impliedProbability(market);
            
            // Determine betting gate state for this market
            let bettingBlocked = false;
            let blockedReason = "";
            // Operator-attested/price markets resolve outside a TxLINE fixture
            // gate — bettable whenever open (same rule as useMarketBettingState).
            if (market.status === "open" && !isFixtureGatedMarket(market)) {
              // no fixture gate
            } else if (market.status === "open" && fixture) {
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

        {/* System chrome (Matchkeeper + proof path) only when there's a real
            match to explain — an empty room shouldn't narrate its plumbing. */}
        {(effectiveFixture || matchMarkets.length > 0) && (
          <div className="match-proof-grid">
            <MatchkeeperStatus updatedAt={snapshot?.updatedAt} marketPhase={phase} events={matchActivity} oracle={matchMarkets[0]?.oracle} />
            <ProofPath status={phase} oracle={matchMarkets[0]?.oracle} />
          </div>
        )}
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
