/**
 * useFixturesMonitor — single fixture list + live score poll for the app.
 */

import { useCallback } from "react";
import type { FixtureWithMatchId, LiveMatchSnapshot } from "@/lib/match/types";
import { isFixtureLive } from "@/lib/match/fixtures";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";

const FIXTURES_REFRESH_MS = 60_000;
const SCORE_POLL_MS = 15_000;

export function useFixturesMonitor() {
  const setFixtures = useStoppageStore((s) => s.setFixtures);
  const setFixturesLoading = useStoppageStore((s) => s.setFixturesLoading);
  const setFixtureScore = useStoppageStore((s) => s.setFixtureScore);
  const clearFixtureScore = useStoppageStore((s) => s.clearFixtureScore);
  const fixtures = useStoppageStore((s) => s.fixtures);

  const refreshFixtures = useCallback(async () => {
    try {
      const response = await fetch("/api/fixtures");
      if (!response.ok) throw new Error("Fixture feed unavailable");
      const data = (await response.json()) as { fixtures?: FixtureWithMatchId[] };
      setFixtures(data.fixtures ?? []);
      setFixturesLoading(false);
    } catch {
      setFixtures([]);
      setFixturesLoading(false);
    }
  }, [setFixtures, setFixturesLoading]);

  const pollScores = useCallback(async () => {
    const currentFixtures = useStoppageStore.getState().fixtures;
    const liveFixtures = currentFixtures.filter((fixture) => isFixtureLive(fixture));
    const liveIds = new Set(liveFixtures.map((fixture) => fixture.FixtureId));

    for (const fixture of currentFixtures) {
      if (!liveIds.has(fixture.FixtureId)) {
        clearFixtureScore(fixture.FixtureId);
      }
    }

    await Promise.all(
      liveFixtures.map(async (fixture) => {
        try {
          const response = await fetch(`/api/fixtures/${fixture.FixtureId}/score`);
          if (!response.ok) throw new Error("Score feed unavailable");
          const data = (await response.json()) as LiveMatchSnapshot;
          setFixtureScore(fixture.FixtureId, data);
        } catch {
          clearFixtureScore(fixture.FixtureId);
        }
      })
    );
  }, [setFixtureScore, clearFixtureScore]);

  usePollingWhenVisible(refreshFixtures, FIXTURES_REFRESH_MS, [refreshFixtures]);
  usePollingWhenVisible(pollScores, SCORE_POLL_MS, [fixtures, pollScores]);
}
