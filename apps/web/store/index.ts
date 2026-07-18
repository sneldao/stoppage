/**
 * Zustand store — slice pattern carried over from pir8's gameStore.
 * Four slices: markets, positions, referral, history.
 */

import { create } from "zustand";
import { createMarketsSlice, type MarketsSlice } from "./marketsSlice";
import { createPositionsSlice, type PositionsSlice } from "./positionsSlice";
import { createReferralSlice, type ReferralSlice } from "./referralSlice";
import { createHistorySlice, type HistorySlice, computeHistoryStats } from "./historySlice";
import { createActivitySlice, type ActivitySlice } from "./activitySlice";
export { computeHistoryStats } from "./historySlice";
export type { HistoryStats, SettledPosition } from "./historySlice";

export type StoppageStore = MarketsSlice & PositionsSlice & ReferralSlice & HistorySlice & ActivitySlice;

export const useStoppageStore = create<StoppageStore>()((...args) => ({
  ...createMarketsSlice(...args),
  ...createPositionsSlice(...args),
  ...createReferralSlice(...args),
  ...createHistorySlice(...args),
  ...createActivitySlice(...args),
}));
