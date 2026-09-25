/**
 * Settled Week — the weekly SOL/USD Pyth window campaign surface.
 *
 * One source of truth (mirrors apps/agent/src/weekKeeper.ts): the keeper
 * opens one market per week, matchId `SOL/USD:W<isoYear>-<isoWeek>`, line =
 * spot at creation (the Friday-open anchor), closing Sunday 23:00 UTC and
 * settling through the proof-gated Pyth path. The PDA is NOT derivable
 * offline (the threshold is only known at creation), so the market is found
 * on-chain by its matchId shape — never hardcoded.
 */

import type { Market } from "@stoppage/sdk";

/** Must match the keeper's PRICE_SYMBOL env (default "SOL/USD"). */
export const WEEK_SYMBOL = "SOL/USD";

/** Window close hour, UTC (Sunday). */
export const WEEK_CLOSE_HOUR_UTC = 23;

/** `SOL/USD:W2026-39` → true. Interval markets use numeric refs, never W. */
export function isWeekMatchId(matchId: string): boolean {
  return /^W\d{4}-\d{2}$/.test(matchId.split(":")[1] ?? "");
}

export interface WeekWindow {
  label: string;
  matchId: string;
  closeMs: number;
}

/** ISO-8601 week number + iso year for the week containing `d`. */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/** The active window: closes the next Sunday 23:00 UTC strictly after now. */
export function weekWindowFor(nowMs: number): WeekWindow {
  const now = new Date(nowMs);
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
  sunday.setUTCHours(WEEK_CLOSE_HOUR_UTC, 0, 0, 0);
  if (sunday.getTime() <= nowMs) sunday.setUTCDate(sunday.getUTCDate() + 7);
  const { year, week } = isoWeek(sunday);
  const label = `W${year}-${String(week).padStart(2, "0")}`;
  return { label, matchId: `${WEEK_SYMBOL}:${label}`, closeMs: sunday.getTime() };
}

/** The on-chain market for a week matchId (keeper created it already?). */
export function findWeekMarket(
  markets: Record<string, Market>,
  matchId: string
): Market | undefined {
  return Object.values(markets).find((m) => m.predicate.matchId === matchId);
}

/**
 * Countdown → window open → awaiting receipt → receipt.
 * (`in_play` is deliberately absent: a price window has no kickoff — the
 * open window IS the play.)
 */
export type WeekPhase = "countdown" | "window_open" | "awaiting_receipt" | "receipt";

export function weekPhase(nowMs: number, market: Market | undefined, window: WeekWindow): WeekPhase {
  if (market?.status === "settled") return "receipt";
  if (market && nowMs < window.closeMs) return "window_open";
  if (!market) return "countdown";
  return "awaiting_receipt";
}

/** Line in USD, from the on-chain market's threshold (1e8-fixed). */
export function weekLineUsd(market: Market): number {
  return Number(market.predicate.params.threshold ?? 0) / 1e8;
}
