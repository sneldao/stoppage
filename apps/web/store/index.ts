/**
 * Zustand store — slice pattern carried over from pir8's gameStore.
 * Three slices: markets, positions, referral.
 */

import { create } from "zustand";
import { createMarketsSlice, type MarketsSlice } from "./marketsSlice";
import { createPositionsSlice, type PositionsSlice } from "./positionsSlice";
import { createReferralSlice, type ReferralSlice } from "./referralSlice";

export type StoppageStore = MarketsSlice & PositionsSlice & ReferralSlice;

export const useStoppageStore = create<StoppageStore>()((...args) => ({
  ...createMarketsSlice(...args),
  ...createPositionsSlice(...args),
  ...createReferralSlice(...args),
}));
