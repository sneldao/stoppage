/**
 * Odds movement tracker — the agent's "sharp movement detector."
 *
 * Maintains a rolling per-market history of implied YES probability and
 * flags significant shifts over a fixed lookback window. Pure: no I/O.
 * The agent loop feeds it pool snapshots; the HTTP server reads from it.
 *
 * This is the in-app counterpart to the TxLINE track's suggested
 * "Sharp Movement Detector" project — movements are logged and surfaced
 * to the UI so a reviewer can see the data granularity in action.
 */

export interface OddsPoint {
  ts: number;
  /** Implied YES probability 0..1 */
  yes: number;
}

export interface OddsShift {
  marketId: string;
  label: string;
  fromTs: number;
  toTs: number;
  fromYes: number;
  toYes: number;
  /** Signed change in probability points, e.g. +0.12 */
  delta: number;
  /** Direction for UI colouring */
  direction: "up" | "down";
}

const MAX_POINTS = 240; // ~2h at 30s cadence, ~8min at 2s cadence
const LOOKBACK_MS = 60_000; // "every 60 seconds" per the track brief
const SHIFT_THRESHOLD = 0.05; // 5 probability points in the window

export class OddsTracker {
  private history = new Map<string, OddsPoint[]>();
  private labels = new Map<string, string>();
  private shifts: OddsShift[] = [];
  private lastShiftAt = new Map<string, number>();

  /** Record a pool snapshot for a market. */
  record(marketId: string, label: string, yesPool: number, noPool: number, ts = Date.now()): void {
    const total = yesPool + noPool;
    if (total <= 0) return;
    const yes = yesPool / total;
    this.labels.set(marketId, label);
    const buf = this.history.get(marketId) ?? [];
    const last = buf[buf.length - 1];
    // Skip sub-second duplicates
    if (last && ts - last.ts < 1000) return;
    buf.push({ ts, yes });
    if (buf.length > MAX_POINTS) buf.shift();
    this.history.set(marketId, buf);
    this.detectShift(marketId, label, buf);
  }

  private detectShift(marketId: string, label: string, buf: OddsPoint[]): void {
    if (buf.length < 2) return;
    const now = buf[buf.length - 1];
    const windowStart = now.ts - LOOKBACK_MS;
    // Oldest point within the lookback window
    let base = buf[0];
    for (const p of buf) {
      if (p.ts >= windowStart) { base = p; break; }
    }
    const delta = now.yes - base.yes;
    if (Math.abs(delta) < SHIFT_THRESHOLD) return;
    // Debounce: at most one shift per market per window
    const lastShift = this.lastShiftAt.get(marketId) ?? 0;
    if (now.ts - lastShift < LOOKBACK_MS) return;
    this.lastShiftAt.set(marketId, now.ts);
    const shift: OddsShift = {
      marketId,
      label,
      fromTs: base.ts,
      toTs: now.ts,
      fromYes: base.yes,
      toYes: now.yes,
      delta,
      direction: delta >= 0 ? "up" : "down",
    };
    this.shifts.unshift(shift);
    if (this.shifts.length > 40) this.shifts.pop();
  }

  /** Recent history for a market, oldest first. */
  getHistory(marketId: string): OddsPoint[] {
    return this.history.get(marketId) ?? [];
  }

  /** Significant shifts, newest first. */
  getShifts(): OddsShift[] {
    return this.shifts;
  }

  getLabel(marketId: string): string | undefined {
    return this.labels.get(marketId);
  }
}
