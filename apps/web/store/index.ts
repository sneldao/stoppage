/**
 * Zustand store — slice pattern carried over from pir8's gameStore.
 * Two slices for now; add a leaderboard slice when settlement history lands.
 */

import { create } from "zustand";
import { createMarketsSlice, type MarketsSlice } from "./marketsSlice";
import { createPositionsSlice, type PositionsSlice } from "./positionsSlice";

export type StoppageStore = MarketsSlice & PositionsSlice;

export const useStoppageStore = create<StoppageStore>()((...args) => ({
  ...createMarketsSlice(...args),
  ...createPositionsSlice(...args),
}));
