/**
 * Tweet text generation for market sharing.
 *
 * Generates shareable tweet text from market data. Lives in lib/share
 * because it's pure formatting — no I/O, no chain calls.
 */

import type { Market } from "@stoppage/sdk";
import { impliedProbability, PREDICATE_LABEL } from "@stoppage/sdk";
import { formatMarketQuestion } from "@/lib/format";

/**
 * Build a tweet-friendly string for a market.
 *
 * @param market - The on-chain market
 * @param url - The share URL (market page or Blink URL)
 * @param ref - Optional referral tag appended to the URL
 */
export function buildMarketTweet(
  market: Market,
  url: string,
  ref?: string
): string {
  const odds = impliedProbability(market);
  const pred = market.predicate;
  const param = pred.params.windowSeconds ?? pred.params.threshold ?? "";
  const team = pred.params.team ? ` · ${pred.params.team}` : "";
  const label = `${PREDICATE_LABEL[pred.kind] ?? pred.kind} ${param}${team}`;
  const poolSol = ((market.yesPool + market.noPool) / 1e9).toFixed(2);
  const yesPct = (odds.yes * 100).toFixed(0);
  const noPct = (odds.no * 100).toFixed(0);

  const fullUrl = ref ? `${url}?ref=${ref}` : url;

  return [
    `⚽ ${label}`,
    `YES ${yesPct}% · NO ${noPct}% · ${poolSol} SOL pool`,
    `Live call with proof-backed settlement on @stoppage.`,
    fullUrl,
  ].join("\n");
}

/**
 * Build the X/Twitter intent URL for posting a tweet.
 */
export function buildTweetIntent(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/**
 * Build a tweet for sharing a placed bet (not just the market).
 * Includes the session-key speed stat as the viral hook.
 *
 * @param market - The on-chain market
 * @param side - Which side was bet
 * @param amountSol - Stake amount in SOL
 * @param signingMs - Signing speed in milliseconds (optional — only for session-key bets)
 * @param url - The share URL
 * @param ref - Optional referral tag
 */
export function buildBetSlipTweet(
  market: Market,
  side: "yes" | "no",
  amountSol: string,
  signingMs: number | undefined,
  url: string,
  ref?: string
): string {
  const odds = impliedProbability(market);
  const label = formatMarketQuestion(market.predicate);
  const sideOdds = side === "yes" ? odds.yes : odds.no;
  const projected = sideOdds > 0 ? `${(parseFloat(amountSol) / sideOdds).toFixed(2)} SOL` : "—";
  const fullUrl = ref ? `${url}?ref=${ref}` : url;

  const speedLine = signingMs !== undefined
    ? `Position signed in ${Math.round(signingMs)}ms.`
    : "Position confirmed on Solana.";

  return [
    `⚽ My call: ${side.toUpperCase()} — ${label}`,
    `${amountSol} SOL at risk · ${projected} estimated return`,
    signingMs !== undefined ? speedLine : "Position confirmed on Solana.",
    fullUrl,
  ].join("\n");
}

/** Build a shareable result only for a completed, proof-backed call. */
export function buildResolutionTweet(
  market: Market,
  side: "yes" | "no",
  isWinner: boolean,
  url: string
): string {
  const label = formatMarketQuestion(market.predicate);
  return [
    `⚽ ${isWinner ? "Called it" : "Result recorded"}: ${label}`,
    `My call ${side.toUpperCase()} · outcome ${market.outcome.toUpperCase()}`,
    "Proof-backed settlement on Stoppage.",
    url,
  ].join("\n");
}
