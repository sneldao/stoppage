"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Market, Position } from "@stoppage/sdk";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import { buildResolutionTweet, buildTweetIntent } from "@/lib/share/tweet";
import { exportTicketAsPng } from "@/lib/share/exportTicketAsPng";
import { useSnsName } from "@/lib/wallet/useSnsName";
import { useStoppageStore } from "@/store";

interface ResolutionCardProps {
  market: Market;
  position: Position;
  isWinner: boolean;
  pageUrl: string;
  /** Optional signing speed in ms — shown on the exported PNG ticket */
  signingMs?: number;
}

/** Settlement is the payoff for the social loop: an immutable result, not a promise. */
export function ResolutionCard({ market, position, isWinner, pageUrl, signingMs }: ResolutionCardProps) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((state) => state.recordShare);
  const referrer = useStoppageStore((state) => state.referrer);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const refTag = publicKey?.toBase58() ?? referrer;
  const snsName = useSnsName(publicKey?.toBase58());
  const resultUrl = `${pageUrl}?side=${position.side}${refTag ? `&ref=${encodeURIComponent(refTag)}` : ""}`;
  const tweetIntent = buildTweetIntent(buildResolutionTweet(market, position.side, isWinner, resultUrl));

  const totalPool = market.yesPool + market.noPool;
  const sidePool = position.side === "yes" ? market.yesPool : market.noPool;
  const payoutLamports = isWinner
    ? sidePool > 0
      ? Math.floor((position.amountLamports * totalPool) / sidePool)
      : position.amountLamports
    : 0;

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(resultUrl);
      setCopied(true);
      recordShare();
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be unavailable in embedded wallet clients.
    }
  };

  const downloadTicket = async () => {
    setDownloading(true);
    try {
      await exportTicketAsPng(
        { market, position, isWinner, signingMs, payoutLamports },
        `stoppage-${market.predicate.matchId}-${position.side}.png`
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className={`resolution-card ${isWinner ? "resolution-card-win" : "resolution-card-result"}`} aria-label="Your settled call">
      <p className="eyebrow">Proof-backed result</p>
      <h2>{isWinner ? "Called it." : "Result recorded."}</h2>
      <p>{formatMarketQuestion(market.predicate)}</p>
      
      <div className="resolution-card-outcome">
        <span>Your call <strong>{position.side.toUpperCase()}</strong></span>
        <span>Outcome <strong>{market.outcome.toUpperCase()}</strong></span>
      </div>

      {/* --- PREMIUM DIGITAL TICKET RECEIPT --- */}
      <div className="digital-ticket">
        <div className="ticket-header">
          <div className="ticket-logo">STOPPAGE RECEIPT</div>
          <span className="ticket-status-tag">VERIFIED ON-CHAIN</span>
        </div>
        <div className="ticket-divider" />
        <div className="ticket-body">
          <div className="ticket-row">
            <span>MATCH ID</span>
            <strong>{market.predicate.matchId}</strong>
          </div>
          <div className="ticket-row">
            <span>MARKET</span>
            <strong>{formatMarketQuestion(market.predicate)}</strong>
          </div>
          <div className="ticket-row">
            <span>YOUR CALL</span>
            <strong>{position.side.toUpperCase()}</strong>
          </div>
          <div className="ticket-row">
            <span>STAKE</span>
            <strong>{SOL(position.amountLamports)} SOL</strong>
          </div>
          <div className="ticket-divider" />
          <div className="ticket-row ticket-row-large">
            <span>{isWinner ? "PAYOUT" : "LOSS"}</span>
            <strong className={isWinner ? "payout-win" : "payout-loss"}>
              {isWinner ? `+${SOL(payoutLamports)} SOL` : `-${SOL(position.amountLamports)} SOL`}
            </strong>
          </div>
        </div>
        <div className="ticket-footer">
          <div className="ticket-signature">
            <span>RESOLVER</span>
            <code>{market.id.slice(0, 12)}...</code>
          </div>
          <div className="ticket-barcode" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
          </div>
        </div>
      </div>

      {isWinner && (
        <div className="resolution-card-actions">
          <a href={tweetIntent} target="_blank" rel="noopener noreferrer" onClick={() => recordShare()}>Share verified call</a>
          <button type="button" onClick={() => void copyResult()}>{copied ? "Link copied" : "Copy result link"}</button>
          <button
            type="button"
            className="ticket-download-btn"
            onClick={() => void downloadTicket()}
            disabled={downloading}
            title={`Downloading as PNG — verified receipt for ${snsName}`}
          >
            {downloading ? "Generating…" : "📸 Download ticket"}
          </button>
          <Link href={`/match?match=${encodeURIComponent(market.predicate.matchId)}`}>Open match room</Link>
        </div>
      )}
      {!isWinner && <Link className="resolution-card-proof" href="#proof">Inspect settlement proof</Link>}
    </section>
  );
}
