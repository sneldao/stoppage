import type { StateCreator } from "zustand";
import type { MatchEvent } from "@stoppage/sdk";

const STORAGE_KEY = "stoppage:activity";
const MAX_ITEMS = 60;

export interface ActivitySlice {
  activity: MatchEvent[];
  recordActivity: (event: MatchEvent) => void;
  initActivity: () => void;
}

function loadActivity() {
  if (typeof window === "undefined") return [] as MatchEvent[];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as MatchEvent[] : [];
  } catch {
    return [] as MatchEvent[];
  }
}

function saveActivity(activity: MatchEvent[]) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(activity));
}

/** Personal signed actions, intentionally separate from the keeper's ledger. */
export const createActivitySlice: StateCreator<ActivitySlice, [], [], ActivitySlice> = (set) => ({
  activity: [],
  recordActivity: (event) => set((state) => {
    const activity = [event, ...state.activity.filter((item) => item.signature !== event.signature && item.id !== event.id)].slice(0, MAX_ITEMS);
    saveActivity(activity);
    return { activity };
  }),
  initActivity: () => set({ activity: loadActivity() }),
});
