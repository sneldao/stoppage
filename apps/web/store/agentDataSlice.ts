import type { StateCreator } from "zustand";

export interface BoardEntry {
  owner: string;
  marketsPlayed: number;
  resolved: number;
  correct: number;
  accuracy: number;
  volumeLamports: number;
  proofMarketIds: string[];
}

export interface BoardData {
  playerCount: number;
  verifiedMarketCount: number;
  totalAttestations: number;
  entries: BoardEntry[];
}

export interface OddsShift {
  marketId: string;
  label: string;
  fromYes: number;
  toYes: number;
  delta: number;
  direction: "up" | "down";
  toTs: number;
}

export interface AgentDataSlice {
  board: BoardData | null;
  boardUnavailable: boolean;
  oddsShifts: OddsShift[];
  oddsShiftsLoading: boolean;
  setBoard: (board: BoardData | null, unavailable?: boolean) => void;
  setOddsShifts: (shifts: OddsShift[], loading?: boolean) => void;
}

export const createAgentDataSlice: StateCreator<AgentDataSlice, [], [], AgentDataSlice> = (set) => ({
  board: null,
  boardUnavailable: false,
  oddsShifts: [],
  oddsShiftsLoading: true,
  setBoard: (board, boardUnavailable = false) => set({ board, boardUnavailable }),
  setOddsShifts: (oddsShifts, oddsShiftsLoading = false) => set({ oddsShifts, oddsShiftsLoading }),
});
