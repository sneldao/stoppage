import type { Fixture } from "@stoppage/txline";

export type FixtureWithMatchId = Fixture & {
  matchId: string;
  /** Server-computed: finished + TxLINE historical scores (GET /api/fixtures). */
  replayable: boolean;
};

export interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

export function snapshotIsFresh(snapshot: LiveMatchSnapshot | null | undefined): boolean {
  if (!snapshot?.updatedAt) return false;
  const timestamp =
    snapshot.updatedAt < 1_000_000_000_000 ? snapshot.updatedAt * 1_000 : snapshot.updatedAt;
  return Date.now() - timestamp <= 45_000;
}
