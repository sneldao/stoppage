"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, PREDICATE_LABEL, type Market, type MatchEvent } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ProofPath } from "@/components/ProofPath";
import { MarketWindow } from "@/components/MarketWindow";
import { formatSol as SOL } from "@/lib/format";

type FixtureWithMatchId = Fixture & { matchId: string };

interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

function isLive(fixture: Fixture | null) {
  return fixture?.GameState === 2 || fixture?.GameState === 4;
}

function question(market: Market) {
  const value = market.predicate.params.windowSeconds ?? market.predicate.params.threshold ?? "";
  const team = market.predicate.params.team ? ` for ${market.predicate.params.team}` : "";
  return `${PREDICATE_LABEL[market.predicate.kind] ?? market.predicate.kind} ${value}${team}`;
}

export default function MatchPage() {
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
  const selectedMatchId = orderedMarkets[0] ? String(orderedMarkets[0].predicate.matchId) : null;
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
    if (!fixture || !isLive(fixture)) {
      setSnapshot(null);
      return;
    }
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
  return (
    <main className="app-shell">
      <div className="match-room">
        <header className="match-room-header">
          <div><p className="eyebrow">Match control room</p><h1>{fixture ? `${fixture.Participant1} v ${fixture.Participant2}` : selectedMatchId ? `Match ${selectedMatchId}` : "Live match context"}</h1></div>
          <Link href="/markets" className="explorer-back">Market tape <span>→</span></Link>
        </header>

        <section className="control-scoreboard" aria-label="Live match scoreboard">
          <div className="control-scoreboard-top"><span className={live ? "match-live" : "match-next"}><i /> {live ? "Live feed" : fixture ? "Fixture feed" : "Fixture mapping pending"}</span><span>{fixture?.Country ?? "TxLINE"}</span></div>
          <div className="control-scoreline"><strong>{fixture?.Participant1 ?? "Home"}</strong><b>{live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}</b><strong>{fixture?.Participant2 ?? "Away"}</strong></div>
          <div className="control-stats"><span>{snapshot ? `Corners ${snapshot.stats.corners}` : "Score state pending"}</span><span>{snapshot ? `Cards ${snapshot.stats.cards}` : "TxLINE connected"}</span><span>{snapshot?.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Match context active"}</span></div>
        </section>

        <section className="match-ownership" aria-label="Your match position">
          <div><p className="eyebrow">Your match context</p><h2>{ownedPositions.length ? `${ownedPositions.length} open ${ownedPositions.length === 1 ? "read" : "reads"}` : "No open read yet."}</h2></div>
          {ownedPositions.length ? <div className="ownership-list">{ownedPositions.map((position) => <Link href={`/markets/${position.marketId}`} key={position.marketId}><strong>{position.side.toUpperCase()} · {SOL(position.amountLamports)}</strong><span>{position.openedViaSessionKey ? "Fast Session" : "Wallet signed"} →</span></Link>)}</div> : <Link className="ownership-action" href={matchMarkets[0] ? `/markets/${matchMarkets[0].id}` : "/markets"}>Choose a live read <span>→</span></Link>}
        </section>

        <section className="match-live-reads" aria-labelledby="match-live-reads-title">
          <div className="section-heading"><div><p className="eyebrow">Live reads</p><h2 id="match-live-reads-title">Markets inside this match.</h2></div><span>{matchMarkets.length} active context</span></div>
          {matchMarkets.length ? <div className="match-market-list">{matchMarkets.map((market) => {
            const odds = impliedProbability(market);
            return <Link className={`match-market-row match-market-${market.status}`} href={`/markets/${market.id}`} key={market.id}><div><span>{market.status.replace("_", " ")}</span><strong>{question(market)}</strong><small>Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><MarketWindow closesAt={market.closesAt} status={market.status} compact /><div className="match-market-odds"><b>YES {Math.round(odds.yes * 100)}%</b><b>NO {Math.round(odds.no * 100)}%</b></div><i>→</i></Link>;
          })}</div> : <div className="match-room-empty">Matchkeeper will publish eligible reads here when the verified match context supports one.</div>}
        </section>

        <div className="match-proof-grid">
          <MatchkeeperStatus updatedAt={snapshot?.updatedAt} marketPhase={phase} events={matchActivity} />
          <ProofPath status={phase} />
        </div>
      </div>
    </main>
  );
}
