/**
 * Tweet text generation for market sharing.
 *
 * Generates shareable tweet text from market data. Lives in lib/share
 * because it's pure formatting — no I/O, no chain calls.
 */

import type { Market } from "@stoppage/sdk";
import { impliedProbability } from "@stoppage/sdk";

const PREDICATE_LABEL: Record<string, string> = {
  next_goal_within: "Next goal within",
  corners_over: "Corners over",
  card_shown: "Card shown",
  total_goals_over: "Total goals over",
};

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
    `Bet in-play on @stoppage — no wallet popup, instant settlement.`,
    fullUrl,
  ].join("\n");
}

/**
 * Build the X/Twitter intent URL for posting a tweet.
 */
export function buildTweetIntent(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
