/**
 * ActivityFeedSlice — the protocol's pulse, shared store-wide.
 *
 * A single hook (useActivityFeedMonitor, called once from the layout)
 * polls /api/match-events and writes the merged feed + new toasts here.
 * ActivitySurfaces, RightNowLine, and any other consumer read from the
 * store instead of each polling separately (rule: one subscription over
 * polling).
 */

import type { StateCreator } from "zustand";
import type { MatchEvent } from "@stoppage/sdk";

export interface ActivityFeedSlice {
  /** Merged keeper + user activity, newest first, capped. */
  feed: MatchEvent[];
  /** New settlement/proof/void events not yet dismissed. */
  toasts: MatchEvent[];
  setFeed: (feed: MatchEvent[]) => void;
  pushToasts: (events: MatchEvent[]) => void;
  dismissToast: (id: string) => void;
}

export const TOAST_KINDS: MatchEvent["kind"][] = [
  "settlement_confirmed",
  "proof_validated",
  "market_voided",
];

export const createActivityFeedSlice: StateCreator<
  ActivityFeedSlice,
  [],
  [],
  ActivityFeedSlice
> = (set) => ({
  feed: [],
  toasts: [],
  setFeed: (feed) => set({ feed }),
  pushToasts: (events) =>
    set((state) => ({ toasts: [...events, ...state.toasts].slice(0, 4) })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
});
