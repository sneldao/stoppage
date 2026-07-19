"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { type Market, type Side } from "@stoppage/sdk";
import { formatMarketQuestion, formatSigningSpeed } from "@/lib/format";
import { buildBetSlipTweet, buildTweetIntent } from "@/lib/share/tweet";
import { useStoppageStore } from "@/store";
import { computeHistoryStats } from "@/store/historySlice";

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
  const history = useStoppageStore((s) => s.history);
  const stats = useMemo(() => computeHistoryStats(history), [history]);
  const isHotStreak = stats.currentStreak >= 3;
  const [copied, setCopied] = useState(false);
  const [copiedBlink, setCopiedBlink] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const challengerBlinkUrl = `${origin}/api/actions/${market.id}?challenger=${publicKey?.toBase58() || ""}&challengerSide=${side}`;
  const refTag = publicKey?.toBase58() ?? referrer ?? undefined;
  const callUrl = `${pageUrl}?side=${side}${refTag ? `&ref=${encodeURIComponent(refTag)}` : ""}`;
  
  const tweetIntent = buildTweetIntent(
    buildBetSlipTweet(market, side, amountSol, signingMs, callUrl, refTag, challengerBlinkUrl)
  );

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

  const copyChallengeBlink = async () => {
    try {
      await navigator.clipboard.writeText(challengerBlinkUrl);
      setCopiedBlink(true);
      recordShare();
      window.setTimeout(() => setCopiedBlink(false), 2_000);
    } catch {
      // Some embedded clients block clipboard access.
    }
  };

  const fillRatio = signingMs !== undefined ? Math.max(0, Math.min(1, (1000 - signingMs) / 950)) : 0;
  const strokeDashoffset = 126 * (1 - fillRatio);

  return (
    <section className={`call-card call-card-${side}${isHotStreak ? " call-card-hot-streak" : ""}`} aria-label="Your confirmed call">
      {isHotStreak && (
        <div className="call-card-streak-banner" aria-live="polite">
          🔥🔥🔥 Hot streak · {stats.currentStreak} in a row
        </div>
      )}
      <div className="call-card-top"><span>Call locked</span><span>{signingMs !== undefined ? `Signed ${formatSigningSpeed(signingMs)}` : "Wallet confirmed"}</span></div>
      <p className="call-card-question">{formatMarketQuestion(market.predicate)}</p>
      
      <div className="call-card-decision">
        <strong>{side.toUpperCase()}</strong>
        <span>{probability}% implied probability · {amountSol} SOL at risk</span>
      </div>

      {/* --- PREMIUM SPEEDOMETER GAUGE --- */}
      {signingMs !== undefined && (
        <div className="speedometer-container">
          <div className="speedometer-gauge">
            <svg viewBox="0 0 100 50" className="gauge-svg">
              <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" strokeLinecap="round" />
              <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--lime)" strokeWidth="6" strokeLinecap="round" strokeDasharray="126" strokeDashoffset={strokeDashoffset} />
            </svg>
            <div className="speedometer-value">
              <strong>{formatSigningSpeed(signingMs)}</strong>
              <span>LOCAL SIGN</span>
            </div>
          </div>
          <div className="speedometer-label">
            ⚡ Signed locally via Session Key. 12x faster than wallet popups.
          </div>
        </div>
      )}

      <div className="call-card-actions call-card-actions--primary">
        <Link href={`/match?match=${encodeURIComponent(market.predicate.matchId)}`} className="setup-guide-cta">
          Watch it live <span>→</span>
        </Link>
      </div>
      <p className="call-card-watch-hint">
        Your call is live. Follow the match feed, see odds move, and get the settlement moment.
      </p>

      <div className="call-card-actions">
        <a href={tweetIntent} target="_blank" rel="noopener noreferrer" onClick={() => recordShare()}>Share Challenge Blink</a>
        <button type="button" onClick={() => void copyCall()}>{copied ? "Link copied" : "Copy call link"}</button>
        <button type="button" onClick={() => void copyChallengeBlink()}>{copiedBlink ? "Blink copied!" : "Copy Challenge Blink"}</button>
      </div>
    </section>
  );
}
