"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { type Market, type Side } from "@stoppage/sdk";
import { formatMarketQuestion, formatSigningSpeed } from "@/lib/format";
import { buildBetSlipTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";

interface CallCardProps {
  market: Market;
  side: Side;
  amountSol: string;
  probability: number;
  signingMs?: number;
  pageUrl: string;
}

/** A compact social artifact created only after a position is confirmed. */
export function CallCard({ market, side, amountSol, probability, signingMs, pageUrl }: CallCardProps) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((state) => state.recordShare);
  const referrer = useStoppageStore((state) => state.referrer);
  const [copied, setCopied] = useState(false);
  const refTag = publicKey?.toBase58() ?? referrer;
  const callUrl = `${pageUrl}?side=${side}${refTag ? `&ref=${encodeURIComponent(refTag)}` : ""}`;
  const tweetIntent = buildTweetIntent(buildBetSlipTweet(market, side, amountSol, signingMs, callUrl));

  const copyCall = async () => {
    try {
      await navigator.clipboard.writeText(callUrl);
      setCopied(true);
      recordShare();
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Some embedded clients block clipboard access.
    }
  };

  return (
    <section className={`call-card call-card-${side}`} aria-label="Your confirmed call">
      <div className="call-card-top"><span>Call locked</span><span>{signingMs !== undefined ? `Signed ${formatSigningSpeed(signingMs)}` : "Wallet confirmed"}</span></div>
      <p className="call-card-question">{formatMarketQuestion(market.predicate)}</p>
      <div className="call-card-decision"><strong>{side.toUpperCase()}</strong><span>{probability}% implied probability · {amountSol} SOL at risk</span></div>
      <div className="call-card-actions">
        <a href={tweetIntent} target="_blank" rel="noopener noreferrer" onClick={() => recordShare()}>Share my call</a>
        <button type="button" onClick={() => void copyCall()}>{copied ? "Link copied" : "Copy call link"}</button>
        <Link href={`/match?match=${encodeURIComponent(market.predicate.matchId)}`}>Open match room</Link>
      </div>
    </section>
  );
}
