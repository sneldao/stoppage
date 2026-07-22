/**
 * FixturesSlice — TxLINE fixture list + live score snapshots.
 *
 * A single hook (useFixturesMonitor, mounted once from the layout) fetches
 * /api/fixtures and polls scores for in-play fixtures. Pages read from here
 * instead of each running their own fetch/poll loops.
 */

import type { StateCreator } from "zustand";
import type { FixtureWithMatchId, LiveMatchSnapshot } from "@/lib/match/types";

export interface FixturesSlice {
  fixtures: FixtureWithMatchId[];
  fixturesLoading: boolean;
  fixtureScores: Record<number, LiveMatchSnapshot>;
  setFixtures: (fixtures: FixtureWithMatchId[]) => void;
  setFixturesLoading: (loading: boolean) => void;
  setFixtureScore: (fixtureId: number, snapshot: LiveMatchSnapshot) => void;
  clearFixtureScore: (fixtureId: number) => void;
}

export const createFixturesSlice: StateCreator<
  FixturesSlice,
  [],
  [],
  FixturesSlice
> = (set) => ({
  fixtures: [],
  fixturesLoading: true,
  fixtureScores: {},
  setFixtures: (fixtures) => set({ fixtures }),
  setFixturesLoading: (fixturesLoading) => set({ fixturesLoading }),
  setFixtureScore: (fixtureId, snapshot) =>
    set((state) => ({
      fixtureScores: { ...state.fixtureScores, [fixtureId]: snapshot },
    })),
  clearFixtureScore: (fixtureId) =>
    set((state) => {
      const next = { ...state.fixtureScores };
      delete next[fixtureId];
      return { fixtureScores: next };
    }),
});
