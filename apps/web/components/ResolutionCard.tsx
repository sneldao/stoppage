"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Market, Position } from "@stoppage/sdk";
import { formatMarketQuestion } from "@/lib/format";
import { buildResolutionTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";

interface ResolutionCardProps {
  market: Market;
  position: Position;
  isWinner: boolean;
  pageUrl: string;
}

/** Settlement is the payoff for the social loop: an immutable result, not a promise. */
export function ResolutionCard({ market, position, isWinner, pageUrl }: ResolutionCardProps) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((state) => state.recordShare);
  const referrer = useStoppageStore((state) => state.referrer);
  const [copied, setCopied] = useState(false);
  const refTag = publicKey?.toBase58() ?? referrer;
  const resultUrl = `${pageUrl}?side=${position.side}${refTag ? `&ref=${encodeURIComponent(refTag)}` : ""}`;
  const tweetIntent = buildTweetIntent(buildResolutionTweet(market, position.side, isWinner, resultUrl));

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

  return (
    <section className={`resolution-card ${isWinner ? "resolution-card-win" : "resolution-card-result"}`} aria-label="Your settled call">
      <p className="eyebrow">Proof-backed result</p>
      <h2>{isWinner ? "Called it." : "Result recorded."}</h2>
      <p>{formatMarketQuestion(market.predicate)}</p>
      <div className="resolution-card-outcome"><span>Your call <strong>{position.side.toUpperCase()}</strong></span><span>Outcome <strong>{market.outcome.toUpperCase()}</strong></span></div>
      {isWinner && <div className="resolution-card-actions"><a href={tweetIntent} target="_blank" rel="noopener noreferrer" onClick={() => recordShare()}>Share verified call</a><button type="button" onClick={() => void copyResult()}>{copied ? "Link copied" : "Copy result link"}</button><Link href={`/match?match=${encodeURIComponent(market.predicate.matchId)}`}>Open match room</Link></div>}
      {!isWinner && <Link className="resolution-card-proof" href="#proof">Inspect settlement proof</Link>}
    </section>
  );
}
