"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import { buildMarketTweet, buildTweetIntent } from "@/lib/share/tweet";
import { formatMarketQuestion } from "@/lib/format";
import { useStoppageStore } from "@/store";

interface ShareBarProps {
  market: Market;
  /** The market page URL (without ref param). */
  pageUrl: string;
  /** Compact mode — show only Share on X + Copy Blink for the demo. */
  compact?: boolean;
}

/**
 * Share bar — X/Twitter share, copy Blink URL, copy direct link,
 * and a visual preview of how the Blink renders in X/wallet clients.
 *
 * Generates a tweet with market odds + pool size, appends the user's
 * wallet as a referral tag, and tracks the share in the referral slice.
 * The Blink preview is a pure client-side mockup using data already
 * available as props — no API call needed because the GET response
 * format is known from app/api/actions/[market]/route.ts.
 */
export function ShareBar({ market, pageUrl, compact = false }: ShareBarProps) {
  const { publicKey } = useWallet();
  const recordShare = useStoppageStore((s) => s.recordShare);
  const referrer = useStoppageStore((s) => s.referrer);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // The ref tag is the user's wallet (if connected), or the person who
  // referred them (so the chain continues). This is attribution, not
  // on-chain — the hackathon demo tracks it client-side.
  const refTag = publicKey?.toBase58() ?? referrer ?? undefined;
  const fullUrl = refTag ? `${pageUrl}?ref=${refTag}` : pageUrl;

  // Blink URL — the Solana Actions endpoint that renders an inline bet
  // slip in X posts and compatible wallets.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const blinkUrl = `${origin}/api/actions/${market.id}`;

  const tweetText = buildMarketTweet(market, pageUrl, refTag);
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

  const odds = impliedProbability(market);
  const yesPct = Math.round(odds.yes * 100);
  const noPct = Math.round(odds.no * 100);
  const poolSol = ((market.yesPool + market.noPool) / 1e9).toFixed(2);
  const title = formatMarketQuestion(market.predicate);

  return (
    <div className="share-bar-wrap">
      <div className={`share-bar${compact ? " share-bar-compact" : ""}`}>
        <a
          href={tweetIntent}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordShare()}
        >
          Share on X
        </a>
        <button onClick={() => copy(blinkUrl, "blink")}>
          {copied === "blink" ? "Copied!" : "Copy Blink URL"}
        </button>
        {!compact && (
          <>
            <button onClick={() => copy(fullUrl, "link")}>
              {copied === "link" ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
              className={showPreview ? "active" : ""}
            >
              {showPreview ? "Hide preview" : "Preview Blink"}
            </button>
          </>
        )}
      </div>

      {showPreview && (
        <div className="blink-preview" aria-label="Blink preview">
          <p className="blink-preview-label">How this market looks in X / wallet clients</p>
          <div className="blink-preview-head">
            <div className="blink-preview-icon">⚽</div>
            <div>
              <p className="blink-preview-title">{title}</p>
              <p className="blink-preview-desc">
                YES {yesPct}% · NO {noPct}% · {poolSol} SOL pool
              </p>
            </div>
          </div>
          <div className="blink-preview-actions">
            <span>Back YES · 0.05 SOL</span>
            <span>Back NO · 0.05 SOL</span>
          </div>
          <p className="blink-preview-hint">
            Tapping an action opens the bet slip. One-tap join on compatible
            wallets; others open the market page.
          </p>
        </div>
      )}
    </div>
  );
}
