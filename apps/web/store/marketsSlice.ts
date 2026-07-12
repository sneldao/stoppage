import type { StateCreator } from "zustand";
import type { Market } from "@stoppage/sdk";

export interface MarketsSlice {
  markets: Record<string, Market>;
  /** Upsert from on-chain fetches or HeliusMonitor settlement events. */
  upsertMarket: (market: Market) => void;
  setMarketStatus: (marketId: string, status: Market["status"]) => void;
}

export const createMarketsSlice: StateCreator<MarketsSlice, [], [], MarketsSlice> = (
  set
) => ({
  markets: {},
  upsertMarket: (market) =>
    set((state) => ({
      markets: { ...state.markets, [market.id]: market },
    })),
  setMarketStatus: (marketId, status) =>
    set((state) => {
      const market = state.markets[marketId];
      if (!market) return state;
      return {
        markets: { ...state.markets, [marketId]: { ...market, status } },
      };
    }),
});
