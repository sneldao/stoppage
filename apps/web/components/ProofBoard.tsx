"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Market } from "@stoppage/sdk";
import { formatSol as SOL } from "@/lib/format";

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

/** Public protocol facts only. Personal performance stays in My form. */
export function ProofBoard({ markets }: ProofBoardProps) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const fallback = useMemo(() => {
    const verified = markets.filter((market) => market.status === "settled" && market.verifications > 0);
    return { verifiedMarketCount: verified.length, totalAttestations: verified.reduce((total, market) => total + market.verifications, 0) };
  }, [markets]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/board")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Board unavailable")))
      .then((data: BoardData) => { if (!cancelled) setBoard(data); })
      .catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; };
  }, []);

  const verifiedMarketCount = board?.verifiedMarketCount ?? fallback.verifiedMarketCount;
  const totalAttestations = board?.totalAttestations ?? fallback.totalAttestations;

  return (
    <section className="proof-board">
      <div className="proof-board-heading">
        <div><p className="eyebrow">Public protocol board</p><h2>Verified form table.</h2></div>
        <span>On-chain positions</span>
      </div>
      <div className="proof-board-metrics">
        <div><strong>{board?.playerCount ?? "—"}</strong><span>Ranked wallets</span></div>
        <div><strong>{verifiedMarketCount}</strong><span>Proof-backed resolutions</span></div>
        <div><strong>{totalAttestations}</strong><span>Public attestations</span></div>
      </div>
      {board?.entries.length ? (
        <div className="proof-board-list">
          {board.entries.slice(0, 3).map((entry, index) => <div className="proof-board-entry" key={entry.owner}><span>#{index + 1} {shortAddress(entry.owner)}</span><strong>{Math.round(entry.accuracy * 100)}% · {entry.correct}/{entry.resolved}</strong><small>{SOL(entry.volumeLamports)}</small>{entry.proofMarketIds[0] && <Link href={`/markets/${entry.proofMarketIds[0]}`}>Proof →</Link>}</div>)}
        </div>
      ) : <p className="proof-board-empty">{unavailable ? "The public index is temporarily unavailable." : "Loading verified positions from the chain…"}</p>}
    </section>
  );
}
