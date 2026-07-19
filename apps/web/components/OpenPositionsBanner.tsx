"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStoppageStore } from "@/store";
import { formatSol as SOL } from "@/lib/format";
import { formatMarketQuestion } from "@/lib/format";

/**
 * Persistent banner surfacing the user's open positions on home and the
 * markets tape — previously a returning user had to open each market to
 * discover they still had money riding on it.
 */
export function OpenPositionsBanner() {
  const { publicKey } = useWallet();
  const positions = useStoppageStore((s) => s.positions);
  const markets = useStoppageStore((s) => s.markets);
  const positionsLoading = useStoppageStore((s) => s.positionsLoading);

  if (!publicKey) return null;

  const owner = publicKey.toBase58();
  const open = Object.values(positions).filter((p) => {
    if (p.owner !== owner || p.amountLamports <= 0) return false;
    const m = markets[p.marketId];
    // Show while open or awaiting settlement; settled is handled by claim UI.
    return m ? m.status === "open" || m.status === "awaiting_settlement" : true;
  });

  // Hydration window: wallet just connected, useMyPositions is fetching
  // the wallet's on-chain Position accounts. Surface a single "Syncing"
  // chip so the user sees their positions are loading — not that they
  // "have no positions" yet. Same live-dot pattern as MarketsEmptyState's
  // refresh-gap badge. Outer wrapper already carries role="status" so
  // the inner element only needs aria-live for cadence — no nested role.
  if (open.length === 0 && positionsLoading) {
    return (
      <div className="open-positions-banner" role="status">
        <div className="open-position-syncing" aria-live="polite">
          <i
            className="live-dot"
            style={{ marginRight: 7, width: 6, height: 6 }}
            aria-hidden="true"
          />
          Syncing positions
        </div>
      </div>
    );
  }

  if (open.length === 0) return null;

  return (
    <div className="open-positions-banner" role="status">
      {open.map((p) => {
        const m = markets[p.marketId];
        return (
          <Link key={`${p.marketId}:${p.owner}`} href={`/markets/${p.marketId}`} className="open-position-chip">
            <span className="open-position-side">{p.side.toUpperCase()}</span>
            <span className="open-position-q">{m ? formatMarketQuestion(m.predicate) : "Live market"}</span>
            <span className="open-position-amt">{SOL(p.amountLamports)}</span>
            {m?.status === "awaiting_settlement" && <span className="open-position-settling">settling…</span>}
          </Link>
        );
      })}
    </div>
  );
}
