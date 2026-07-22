import { useMemo } from "react";
import { useStoppageStore } from "@/store";
import type { FixtureWithMatchId, LiveMatchSnapshot } from "@/lib/match/types";

export function useFixtures() {
  const fixtures = useStoppageStore((s) => s.fixtures);
  const fixturesLoading = useStoppageStore((s) => s.fixturesLoading);
  return { fixtures, fixturesLoading };
}

export function useFixtureScore(fixtureId: number | null | undefined): LiveMatchSnapshot | null {
  return useStoppageStore((s) =>
    fixtureId != null ? s.fixtureScores[fixtureId] ?? null : null
  );
}

export function useFixtureByMatchId(matchId: string | null | undefined): FixtureWithMatchId | null {
  const fixtures = useStoppageStore((s) => s.fixtures);
  return useMemo(() => {
    if (!matchId) return null;
    return fixtures.find((fixture) => fixture.matchId === matchId) ?? null;
  }, [fixtures, matchId]);
}
