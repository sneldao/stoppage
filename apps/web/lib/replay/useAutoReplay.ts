/**
 * useAutoReplay — turns dead time into a self-running demo.
 *
 * When no fixture is live, rotate finished fixtures through the live
 * pipeline: launch the first replayable match, and as each replay ends
 * (or a launch fails), advance to the next one — same rotation pattern
 * as the match room (useMatchRoomReplay). Fixes the agent rejecting a
 * fixture (no TxLINE historical scores) are recorded in the store's
 * blocklist so they are skipped across the app; a launch failing for
 * any other reason skips just that attempt and retries on the next
 * rotation tick.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { listReplayableFixtures } from "@/lib/match/fixtures";
import { useStoppageStore } from "@/store";
import { useReplay } from "@/lib/replay/useReplay";

export type { ReplayStatus } from "@/store/replaySlice";

const ROTATE_MS = 25_000;
/** After a replay finishes, dwell this many rotation ticks on the finished
 *  match (badge shows "Replay settling…") before rotating to the next. */
const SETTLE_TICKS = 1;

export interface UseAutoReplayOptions {
  /** When true, a live fixture is in play — do not auto-replay. */
  hasLive: boolean;
  /** All fixtures (used to pick featured replays). */
  fixtures: FixtureWithMatchId[];
  /** Featured-priority list — if any completed fixture matches, prefer it. */
  preferTeams?: string[];
}

export function useAutoReplay(opts: UseAutoReplayOptions) {
  const { hasLive, fixtures, preferTeams } = opts;
  const blockedIds = useStoppageStore((s) => s.replayBlockedFixtureIds);
  const blockedKey = blockedIds.join(",");
  const blocked = useMemo(() => new Set(blockedIds), [blockedIds]);
  const replayable = useMemo(
    () => listReplayableFixtures(fixtures, blocked, preferTeams),
    [fixtures, blocked, preferTeams]
  );
  const { status, launching, error, launch, isActive } = useReplay();
  const cursorRef = useRef(0);
  const attemptsRef = useRef(0);
  const dwellRef = useRef(0);
  const justFinishedRef = useRef(false);

  const pickNext = useCallback((): number | null => {
    if (replayable.length === 0) return null;
    const fixture = replayable[cursorRef.current % replayable.length];
    cursorRef.current += 1;
    return fixture?.FixtureId ?? null;
  }, [replayable]);

  useEffect(() => {
    cursorRef.current = 0;
    attemptsRef.current = 0;
    dwellRef.current = 0;
  }, [hasLive, blockedKey, replayable.length]);

  // Detect the active → finished transition (a replay ran its course).
  useEffect(() => {
    if (status?.active && status.finished) justFinishedRef.current = true;
  }, [status?.active, status?.finished]);

  useEffect(() => {
    if (hasLive || replayable.length === 0) return;

    const attempt = () => {
      const state = useStoppageStore.getState();
      if (state.replayStatus?.active || state.replayLaunching) return;
      const isFirst = cursorRef.current === 0 && attemptsRef.current === 0;
      if (justFinishedRef.current) {
        // The replay ran its course — dwell on it while the agent settles
        // its markets, then rotate to the next fixture.
        justFinishedRef.current = false;
        dwellRef.current = SETTLE_TICKS;
        return;
      }
      if (dwellRef.current > 0) {
        dwellRef.current -= 1;
        if (dwellRef.current > 0) return;
        pickNext();
      } else if (!isFirst) {
        // Idle but not post-finish (a failed launch) — advance the rotation.
        pickNext();
      }
      attemptsRef.current += 1;
      const fixtureId = replayable[cursorRef.current % replayable.length]?.FixtureId;
      if (fixtureId != null) void launch(fixtureId);
    };

    attempt();
    const id = window.setInterval(attempt, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [hasLive, replayable, blockedKey, pickNext, launch]);

  return {
    status,
    launching,
    error,
    launch,
    isReplay: isActive && !hasLive,
    replayable,
  };
}

export default useAutoReplay;
