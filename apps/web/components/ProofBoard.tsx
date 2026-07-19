"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Market } from "@stoppage/sdk";
import { formatSol as SOL } from "@/lib/format";
import { useCountUp } from "@/lib/anim/useCountUp";

interface BoardEntry {
  owner: string;
  marketsPlayed: number;
  resolved: number;
  correct: number;
  accuracy: number;
  volumeLamports: number;
  proofMarketIds: string[];
}

interface BoardData {
  playerCount: number;
  verifiedMarketCount: number;
  totalAttestations: number;
  entries: BoardEntry[];
}

interface ProofBoardProps {
  markets: Market[];
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** A single metric that counts up to its target when it rises. */
function CountUpMetric({ value, format }: { value: number; format?: (n: number) => string }) {
  const display = useCountUp(value, 900, value > 0);
  return <strong>{format ? format(display) : Math.round(display)}</strong>;
}

/** Public protocol facts only. Personal performance stays in My form. */
export function ProofBoard({ markets }: ProofBoardProps) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const fallback = useMemo(() => {
    const verified = markets.filter((market) => market.status === "settled" && market.verifications > 0);
    return { verifiedMarketCount: verified.length, totalAttestations: verified.reduce((total, market) => total + market.verifications, 0) };
  }, [markets]);

  // Poll the board so metrics tick up live as new attestations / verifications land.
  useEffect(() => {
    let cancelled = false;
    let first = true;
    const load = async () => {
      try {
        const res = await fetch("/api/board");
        if (!res.ok) { if (first) setUnavailable(true); return; }
        const data: BoardData = await res.json();
        if (!cancelled) { setBoard(data); setUnavailable(false); }
      } catch {
        if (first && !cancelled) setUnavailable(true);
      } finally {
        first = false;
      }
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const verifiedMarketCount = board?.verifiedMarketCount ?? fallback.verifiedMarketCount;
  const totalAttestations = board?.totalAttestations ?? fallback.totalAttestations;
  const playerCount = board?.playerCount ?? 0;
  const totalWagered = board?.entries.reduce((s, e) => s + e.volumeLamports, 0) ?? 0;

  return (
    <section className="proof-board">
      <div className="proof-board-heading">
        <div><p className="eyebrow">Public protocol board</p><h2>Verified form table.</h2></div>
        <span>On-chain positions</span>
      </div>
      <div className="proof-board-metrics">
        <div><CountUpMetric value={playerCount} /><span>Ranked wallets</span></div>
        <div><CountUpMetric value={verifiedMarketCount} /><span>Proof-backed resolutions</span></div>
        <div><CountUpMetric value={totalAttestations} /><span>Public attestations</span></div>
        {totalWagered > 0 && (
          <div><CountUpMetric value={totalWagered} format={(n) => SOL(n)} /><span>Total wagered</span></div>
        )}
      </div>
      {board?.entries.length ? (
        <div className="proof-board-list">
          {board.entries.slice(0, 3).map((entry, index) => <div className="proof-board-entry" key={entry.owner}><span>#{index + 1} {shortAddress(entry.owner)}</span><strong>{Math.round(entry.accuracy * 100)}% · {entry.correct}/{entry.resolved}</strong><small>{SOL(entry.volumeLamports)}</small>{entry.proofMarketIds[0] && <Link href={`/markets/${entry.proofMarketIds[0]}`}>Proof →</Link>}</div>)}
        </div>
      ) : <p className="proof-board-empty">{unavailable ? "The public index is temporarily unavailable." : "Loading verified positions from the chain…"}</p>}
    </section>
  );
}
