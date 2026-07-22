import type { StateCreator } from "zustand";

export interface ReplayStatus {
  active: boolean;
  fixtureId?: number;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  startedAt?: number;
  finished?: boolean;
}

export interface ReplaySlice {
  replayStatus: ReplayStatus | null;
  replayLaunching: boolean;
  replayError: string | null;
  setReplayStatus: (status: ReplayStatus | null) => void;
  setReplayLaunching: (launching: boolean) => void;
  setReplayError: (error: string | null) => void;
}

export const createReplaySlice: StateCreator<ReplaySlice, [], [], ReplaySlice> = (set) => ({
  replayStatus: null,
  replayLaunching: false,
  replayError: null,
  setReplayStatus: (replayStatus) => set({ replayStatus }),
  setReplayLaunching: (replayLaunching) => set({ replayLaunching }),
  setReplayError: (replayError) => set({ replayError }),
});
