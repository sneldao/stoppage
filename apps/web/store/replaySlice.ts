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
  /** Fixtures the agent rejected (no TxLINE historical scores). */
  replayBlockedFixtureIds: number[];
  setReplayStatus: (status: ReplayStatus | null) => void;
  setReplayLaunching: (launching: boolean) => void;
  setReplayError: (error: string | null) => void;
  markReplayBlocked: (fixtureId: number) => void;
}

export const createReplaySlice: StateCreator<ReplaySlice, [], [], ReplaySlice> = (set) => ({
  replayStatus: null,
  replayLaunching: false,
  replayError: null,
  replayBlockedFixtureIds: [],
  setReplayStatus: (replayStatus) => set({ replayStatus }),
  setReplayLaunching: (replayLaunching) => set({ replayLaunching }),
  setReplayError: (replayError) => set({ replayError }),
  markReplayBlocked: (fixtureId) =>
    set((state) =>
      state.replayBlockedFixtureIds.includes(fixtureId)
        ? state
        : { replayBlockedFixtureIds: [...state.replayBlockedFixtureIds, fixtureId] }
    ),
});
