"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Market } from "@stoppage/sdk";
import { buildMarketTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";

interface ShareBarProps {
  market: Market;
  /** The market page URL (without ref param). */
  pageUrl: string;
}

/**
 * Share bar — X/Twitter share, copy Blink URL, copy direct link.
 *
 * Generates a tweet with market odds + pool size, appends the user's
 * wallet as a referral tag, and tracks the share in the referral slice.
 */
export function ShareBar({ market, pageUrl }: ShareBarProps) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((s) => s.recordShare);
  const referrer = useStoppageStore((s) => s.referrer);
  const [copied, setCopied] = useState<string | null>(null);

  // The ref tag is the user's wallet (if connected), or the person who
  // referred them (so the chain continues). This is attribution, not
  // on-chain — the hackathon demo tracks it client-side.
  const refTag = publicKey?.toBase58() ?? referrer ?? undefined;
  const fullUrl = refTag ? `${pageUrl}?ref=${refTag}` : pageUrl;

  // Blink URL — the Solana Actions endpoint that renders an inline bet
  // slip in X posts and compatible wallets.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const blinkUrl = `${origin}/api/actions/${market.id}`;

  const tweetText = buildMarketTweet(market, fullUrl, refTag);
  const tweetIntent = buildTweetIntent(tweetText);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      recordShare();
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard may be blocked — ignore
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={tweetIntent}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => recordShare()}
        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-white/[0.08] hover:text-white"
      >
        Share on X
      </a>
      <button
        onClick={() => copy(blinkUrl, "blink")}
        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-white/[0.08] hover:text-white"
      >
        {copied === "blink" ? "Copied!" : "Copy Blink URL"}
      </button>
      <button
        onClick={() => copy(fullUrl, "link")}
        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-white/[0.08] hover:text-white"
      >
        {copied === "link" ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
