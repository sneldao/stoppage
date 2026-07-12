import type { StateCreator } from "zustand";
import type { Position } from "@stoppage/sdk";

export interface PositionsSlice {
  /** Keyed by `${marketId}:${owner}` — one position per market per wallet. */
  positions: Record<string, Position>;
  addPosition: (position: Position) => void;
  clearPositions: () => void;
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
  addPosition: (position) =>
    set((state) => ({
      positions: { ...state.positions, [positionKey(position)]: position },
    })),
  clearPositions: () => set({ positions: {} }),
});
