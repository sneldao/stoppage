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
import { createActivityFeedSlice, type ActivityFeedSlice, TOAST_KINDS } from "./activityFeedSlice";
import { createFixturesSlice, type FixturesSlice } from "./fixturesSlice";
import { createOddsHistorySlice, type OddsHistorySlice } from "./oddsHistorySlice";
import { createReplaySlice, type ReplaySlice } from "./replaySlice";
import { createAgentDataSlice, type AgentDataSlice } from "./agentDataSlice";
import { createTickerSlice, type TickerSlice } from "./tickerSlice";
export { computeHistoryStats } from "./historySlice";
export type { HistoryStats, SettledPosition } from "./historySlice";
export { TOAST_KINDS } from "./activityFeedSlice";
export type { OddsPoint } from "./oddsHistorySlice";
export type { ReplayStatus } from "./replaySlice";
export type { BoardData, BoardEntry, OddsShift } from "./agentDataSlice";
export type { TickerItem, TickerSource } from "./tickerSlice";

export type StoppageStore = MarketsSlice & PositionsSlice & ReferralSlice & HistorySlice & ActivitySlice & ActivityFeedSlice & FixturesSlice & OddsHistorySlice & ReplaySlice & AgentDataSlice & TickerSlice;

export const useStoppageStore = create<StoppageStore>()((...args) => ({
  ...createMarketsSlice(...args),
  ...createPositionsSlice(...args),
  ...createReferralSlice(...args),
  ...createHistorySlice(...args),
  ...createActivitySlice(...args),
  ...createActivityFeedSlice(...args),
  ...createFixturesSlice(...args),
  ...createOddsHistorySlice(...args),
  ...createReplaySlice(...args),
  ...createAgentDataSlice(...args),
  ...createTickerSlice(...args),
}));
