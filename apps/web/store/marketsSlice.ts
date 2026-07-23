import type { StateCreator } from "zustand";
import type { Market } from "@stoppage/sdk";

/** Live on-chain feed state — surfaced in the nav badge instead of static text. */
export type FeedState = "connected" | "polling" | "offline";

export interface MarketsSlice {
  markets: Record<string, Market>;
  /** True until the first markets fetch completes (drives skeletons). */
  marketsLoading: boolean;
  /** Live feed state from useHeliusMonitor. */
  feedState: FeedState;
  /** Upsert from on-chain fetches or HeliusMonitor settlement events. */
  upsertMarket: (market: Market) => void;
  setMarketStatus: (marketId: string, status: Market["status"]) => void;
  setMarketsLoading: (loading: boolean) => void;
  setFeedState: (state: FeedState) => void;
}

export const createMarketsSlice: StateCreator<MarketsSlice, [], [], MarketsSlice> = (
  set
) => ({
  markets: {},
  marketsLoading: true,
  feedState: "polling",
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
  setMarketsLoading: (loading) =>
    set((state) => (state.marketsLoading === loading ? state : { marketsLoading: loading })),
  setFeedState: (feedState) =>
    set((state) => (state.feedState === feedState ? state : { feedState })),
});
