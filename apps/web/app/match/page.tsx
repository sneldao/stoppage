"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market, type MatchEvent } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ProofPath } from "@/components/ProofPath";
import { MarketWindow } from "@/components/MarketWindow";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import { LiveMatchBar } from "@/components/LiveMatchBar";
import { ReplayLauncher } from "@/components/ReplayLauncher";
import { SharpMoves } from "@/components/SharpMoves";
import { OddsSparkline } from "@/components/OddsSparkline";
import { MatchSignal } from "@/components/MatchSignal";
import { MatchPulse } from "@/components/MatchPulse";

type FixtureWithMatchId = Fixture & { matchId: string };

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

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

function MatchRoomContent() {
  const searchParams = useSearchParams();
  const { markets } = useMarkets();
  useHeliusMonitor();
  useMyPositions();
  const { publicKey } = useWallet();
  const positions = useStoppageStore((state) => state.positions);
  const activity = useStoppageStore((state) => state.activity);
  const [fixtures, setFixtures] = useState<FixtureWithMatchId[]>([]);
  const [snapshot, setSnapshot] = useState<LiveMatchSnapshot | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const orderedMarkets = useMemo(() => Object.values(markets).sort((a, b) => a.closesAt.localeCompare(b.closesAt)), [markets]);
  const requestedMatchId = searchParams.get("match");
  const selectedMatchId = requestedMatchId && orderedMarkets.some((market) => String(market.predicate.matchId) === requestedMatchId)
    ? requestedMatchId
    : orderedMarkets[0] ? String(orderedMarkets[0].predicate.matchId) : null;
  const fixture = useMemo(() => {
    if (selectedMatchId) return fixtures.find((item) => item.matchId === selectedMatchId) ?? null;
    return fixtures.find((item) => isLive(item)) ?? fixtures[0] ?? null;
  }, [fixtures, selectedMatchId]);
  const matchMarkets = useMemo(() => selectedMatchId ? orderedMarkets.filter((market) => String(market.predicate.matchId) === selectedMatchId) : orderedMarkets, [orderedMarkets, selectedMatchId]);
  const ownedPositions = useMemo(() => {
    if (!publicKey) return [];
    const marketIds = new Set(matchMarkets.map((market) => market.id));
    return Object.values(positions).filter((position) => position.owner === publicKey.toBase58() && marketIds.has(position.marketId));
  }, [matchMarkets, positions, publicKey]);
  const phase = matchMarkets.find((market) => market.status === "open")?.status ?? matchMarkets[0]?.status ?? "open";

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fixtures")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Fixture feed unavailable")))
      .then((data) => { if (!cancelled) setFixtures(data.fixtures ?? []); })
      .catch(() => { if (!cancelled) setFixtures([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fixture) { setSnapshot(null); return; }
    if (!isLive(fixture)) return; // skip poll for non-live; the SSE phase drives the snapshot during replays
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/fixtures/${fixture.FixtureId}/score`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Score feed unavailable")))
        .then((data: LiveMatchSnapshot) => { if (!cancelled) setSnapshot(data); })
        .catch(() => { if (!cancelled) setSnapshot(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [fixture]);

  useEffect(() => {
    const query = selectedMatchId ? `?matchId=${encodeURIComponent(selectedMatchId)}` : "";
    let cancelled = false;
    const refresh = () => {
      void fetch(`/api/match-events${query}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Matchkeeper activity unavailable")))
        .then((data: { events?: MatchEvent[] }) => { if (!cancelled) setEvents(data.events ?? []); })
        .catch(() => { if (!cancelled) setEvents([]); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedMatchId]);

  const matchActivity = useMemo(() => {
    const seen = new Set<string>();
    return [...events, ...activity]
      .filter((event) => event.matchId === selectedMatchId)
      .filter((event) => {
        const key = event.signature ?? event.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }, [activity, events, selectedMatchId]);

  const live = isLive(fixture);
  const fresh = snapshotIsFresh(snapshot);
  return (
    <main className="app-shell">
      <div className="match-room">
        <MatchPulse live={live} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--match" />
        <header className="match-room-header">
          <div><p className="eyebrow">Match</p><h1>{fixture ? `${fixture.Participant1} v ${fixture.Participant2}` : selectedMatchId ? `Match ${selectedMatchId}` : "Live match"}</h1></div>
          <Link href="/markets" className="explorer-back">Markets <span>→</span></Link>
        </header>

        <section className="control-scoreboard" aria-label="Live match scoreboard">
          <div className="control-scoreboard-top"><span className={live ? "match-live" : "match-next"}><i /> {live ? fresh ? "Live feed" : "Feed delayed" : fixture ? "Awaiting kickoff" : "No live match right now"}</span><span>{fixture?.Country ?? "TxLINE"}</span></div>
          <div className="control-scoreline"><strong>{fixture?.Participant1 ?? "Home"}</strong><b>{live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</b><strong>{fixture?.Participant2 ?? "Away"}</strong></div>
          <div className="control-stats"><span>{snapshot ? `Corners ${snapshot.stats.corners}` : "Listening"}</span><span>{snapshot ? `Cards ${snapshot.stats.cards}` : live ? "Do not rely on delayed data" : "Listening for the next match"}</span><span>{snapshot?.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Listening for the next match"}</span></div>
          {selectedMatchId && <LiveMatchBar matchId={selectedMatchId} onPhase={(phase) => setSnapshot({ updatedAt: Date.now(), score: { home: phase.score.home ?? 0, away: phase.score.away ?? 0 }, stats: { corners: 0, cards: 0 } })} />}
          <ReplayLauncher
            fixtures={fixtures.filter((f) => !isLive(f)).slice().sort((a, b) => {
              // StartTime may arrive as string ISO or numeric epoch — normalise both
              const ta = typeof a.StartTime === "string" ? a.StartTime : new Date((a.StartTime as unknown as number) * 1000).toISOString();
              const tb = typeof b.StartTime === "string" ? b.StartTime : new Date((b.StartTime as unknown as number) * 1000).toISOString();
              return tb.localeCompare(ta);
            })}
            onLaunched={() => { /* the SSE feed picks the replay up automatically */ }}
          />
        </section>

        <MatchSignal markets={matchMarkets} />
        <SharpMoves />

        <section className="match-ownership" aria-label="Your match position">
          <div><p className="eyebrow">Your positions</p><h2>{ownedPositions.length ? `${ownedPositions.length} open ${ownedPositions.length === 1 ? "bet" : "bets"}` : "No bets yet."}</h2></div>
          {ownedPositions.length ? <div className="ownership-list">{ownedPositions.map((position) => <Link href={`/markets/${position.marketId}`} key={position.marketId}><strong>{position.side.toUpperCase()} · {SOL(position.amountLamports)}</strong><span>{position.openedViaSessionKey ? "One-tap" : "Wallet signed"} →</span></Link>)}</div> : <Link className="ownership-action" href={matchMarkets[0] ? `/markets/${matchMarkets[0].id}` : "/markets"}>Place a bet <span>→</span></Link>}
        </section>

        <section className="match-live-reads" aria-labelledby="match-live-reads-title">
          <div className="section-heading"><div><p className="eyebrow">Live markets</p><h2 id="match-live-reads-title">Markets for this match.</h2></div><span>{matchMarkets.length} active</span></div>
          {matchMarkets.length ? <div className="match-market-list">{matchMarkets.map((market) => {
            const odds = impliedProbability(market);
            return <Link className={`match-market-row match-market-${market.status}`} href={`/markets/${market.id}`} key={market.id}><div><span>{market.status.replace("_", " ")}</span><strong>{formatMarketQuestion(market.predicate)}</strong><small>Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><MarketWindow closesAt={market.closesAt} status={market.status} compact /><div className="match-market-odds"><OddsSparkline marketId={market.id} currentYes={odds.yes} /><b>YES {Math.round(odds.yes * 100)}%</b><b>NO {Math.round(odds.no * 100)}%</b></div><i>→</i></Link>;
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
