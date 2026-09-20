/**
 * useFixturesMonitor — single fixture list + live score poll for the app.
 */

import { useCallback, useRef } from "react";
import type { FixtureWithMatchId, LiveMatchSnapshot } from "@/lib/match/types";
import { isFixtureLive } from "@/lib/match/fixtures";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";

const FIXTURES_REFRESH_MS = 60_000;
const SCORE_POLL_MS = 15_000;
/** Cap failure backoff at 5 minutes — the feed recovers, the client waits. */
const MAX_BACKOFF_MS = 5 * 60_000;

export function useFixturesMonitor() {
  const setFixtures = useStoppageStore((s) => s.setFixtures);
  const setFixturesLoading = useStoppageStore((s) => s.setFixturesLoading);
  const setFixtureScore = useStoppageStore((s) => s.setFixtureScore);
  const clearFixtureScore = useStoppageStore((s) => s.clearFixtureScore);
  const fixtures = useStoppageStore((s) => s.fixtures);
  // Consecutive-failure backoff: a 401 storm (stale creds) or 429 (rate
  // limit) must not retry at full rate forever. 429s back off steeper.
  const failuresRef = useRef(0);
  const retryAtRef = useRef(0);

  const refreshFixtures = useCallback(async () => {
    if (Date.now() < retryAtRef.current) return;
    try {
      const response = await fetch("/api/fixtures");
      if (!response.ok) {
        const step = response.status === 429 ? 2 : 1;
        failuresRef.current += step;
        const wait = Math.min(FIXTURES_REFRESH_MS * 2 ** (failuresRef.current - 1), MAX_BACKOFF_MS);
        retryAtRef.current = Date.now() + wait;
        throw new Error("Fixture feed unavailable");
      }
      const data = (await response.json()) as { fixtures?: FixtureWithMatchId[] };
      setFixtures(data.fixtures ?? []);
      setFixturesLoading(false);
      failuresRef.current = 0;
      retryAtRef.current = 0;
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
