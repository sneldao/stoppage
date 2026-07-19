import type { StateCreator } from "zustand";
import type { Position } from "@stoppage/sdk";

export interface PositionsSlice {
  /** Keyed by `${marketId}:${owner}` — one position per market per wallet. */
  positions: Record<string, Position>;
  /** True while useMyPositions is fetching the wallet's on-chain accounts.
   *  Used by OpenPositionsBanner to surface a "Syncing positions" chip
   *  during the brief hydration window after wallet connect. */
  positionsLoading: boolean;
  addPosition: (position: Position) => void;
  clearPositions: () => void;
  setPositionsLoading: (loading: boolean) => void;
}

export const positionKey = (p: Pick<Position, "marketId" | "owner">) =>
  `${p.marketId}:${p.owner}`;

export const createPositionsSlice: StateCreator<
  PositionsSlice,
  [],
  [],
  PositionsSlice
> = (set) => ({
  positions: {},
  positionsLoading: false,
  addPosition: (position) =>
    set((state) => ({
      positions: { ...state.positions, [positionKey(position)]: position },
    })),
  clearPositions: () => set({ positions: {}, positionsLoading: false }),
  setPositionsLoading: (loading) => set({ positionsLoading: loading }),
});
