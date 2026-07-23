/**
 * useMatchRoomReplay — dead-time replay rotation for the match room.
 *
 * When no fixture is live and the user hasn't pinned a match, auto-launch
 * finished fixtures that TxLINE can actually replay, rotating on a timer.
 * Skips fixtures the agent has already rejected (no historical scores).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { listReplayableFixtures } from "@/lib/match/fixtures";
import { useStoppageStore } from "@/store";
import { useReplay } from "@/lib/replay/useReplay";

const ROTATE_MS = 25_000;

export interface UseMatchRoomReplayOptions {
  /** When false, do not auto-launch (live match or URL-pinned match). */
  enabled: boolean;
  fixtures: FixtureWithMatchId[];
}

export function useMatchRoomReplay({ enabled, fixtures }: UseMatchRoomReplayOptions) {
  const blockedIds = useStoppageStore((s) => s.replayBlockedFixtureIds);
  const blockedKey = blockedIds.join(",");
  const blocked = useMemo(() => new Set(blockedIds), [blockedIds]);
  const replayable = useMemo(
    () => listReplayableFixtures(fixtures, blocked),
    [fixtures, blocked]
  );
  const { status, launching, error, launch, isActive } = useReplay();
  const cursorRef = useRef(0);

  const pickNext = useCallback((): number | null => {
    if (replayable.length === 0) return null;
    const fixture = replayable[cursorRef.current % replayable.length];
    cursorRef.current += 1;
    return fixture?.FixtureId ?? null;
  }, [replayable]);

  useEffect(() => {
    cursorRef.current = 0;
  }, [enabled, blockedKey, replayable.length]);

  useEffect(() => {
    if (!enabled || replayable.length === 0) return;

    const attempt = () => {
      const state = useStoppageStore.getState();
      if (state.replayStatus?.active || state.replayLaunching) return;
      const fixtureId = pickNext();
      if (fixtureId != null) void launch(fixtureId);
    };

    attempt();
    const id = window.setInterval(attempt, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [enabled, replayable.length, blockedKey, pickNext, launch]);

  return {
    status,
    launching,
    error,
    launch,
    isReplay: isActive && enabled,
    replayable,
  };
}
