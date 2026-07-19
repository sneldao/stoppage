/**
 * Market-maker quoting — the Goldman-style layer on top of the fair value.
 *
 * The spread scales with model uncertainty (wider CI => wider spread, since
 * the maker is less sure and charges more for taking the other side) and
 * shifts with inventory (long position => lower the mid to attract
 * unwinders). Kelly sizing tells the agent how much depth to quote at the
 * edge, sized by estimated advantage.
 */

import type { ModelParams } from "./modelParams";

export interface Quote {
  /** Fair probability in [0,1]. */
  fairValue: number;
  /** Bid (maker buys yes) in [0,1], <= fairValue. */
  bid: number;
  /** Ask (maker sells yes) in [0,1], >= fairValue. */
  ask: number;
}

export interface Inventory {
  /** Signed net "yes" position the agent holds. + = long yes, - = long no. */
  netYes: number;
  /** Notional used to normalize the inventory ratio (e.g. pool size). */
  notional: number;
}

export function makeQuote(
  fairValue: number,
  ci: [number, number],
  params: ModelParams,
  inventory: Inventory = { netYes: 0, notional: 1 },
): Quote {
  const ciWidth = Math.max(0, ci[1] - ci[0]);
  const halfSpreadBps = params.spreadBaseBps + params.spreadPerCiBps * ciWidth;
  const halfSpread = halfSpreadBps / 10_000;

  // Inventory skew: long yes => lower mid to attract yes-sellers (the
  // maker unwinds its long by buying back at a keener bid). Clamped so a
  // huge position can't invert the book.
  const inv = inventory.notional > 0 ? inventory.netYes / inventory.notional : 0;
  const skew = -params.inventorySkew * Math.max(-1, Math.min(1, inv));
  const mid = fairValue + skew;

  let bid = mid - halfSpread;
  let ask = mid + halfSpread;

  bid = Math.max(0, Math.min(1, bid));
  ask = Math.max(0, Math.min(1, ask));

  // Defensive fallbacks so bid < ask always holds, even at the [0,1] rails.
  if (bid >= ask) {
    bid = Math.max(0, fairValue - halfSpread);
    ask = Math.min(1, fairValue + halfSpread);
  }
  if (bid >= ask) {
    bid = Math.max(0, fairValue - 0.001);
    ask = Math.min(1, fairValue + 0.001);
  }
  if (bid >= ask) {
    bid = fairValue;
    ask = Math.min(1, fairValue + 0.0001);
  }
  return { fairValue, bid, ask };
}

/**
 * Kelly fraction for a binary outcome at decimal odds `decimalOdds`
 * (total return per unit staked, e.g. 2.0 = double-or-nothing). The net
 * profit per unit staked is b = decimalOdds - 1, so f* = (b*p - q)/b where
 * q = 1 - p. Clamped to [0,1]; returns 0 when there is no edge.
 *
 * Examples: p=0.6 @ 2.0 => 0.2 (edge); p=0.5 @ 2.0 => 0 (fair bet, no edge);
 * decimalOdds <= 1 => 0 (no profit possible).
 */
export function kellyFraction(p: number, decimalOdds: number): number {
  const b = decimalOdds - 1; // net profit per unit staked
  if (!(b > 0)) return 0;
  const f = (b * p - (1 - p)) / b;
  return Math.max(0, Math.min(1, f));
}
