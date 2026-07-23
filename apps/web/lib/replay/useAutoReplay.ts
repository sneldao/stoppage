/**
 * useAutoReplay — turns dead time into a self-running demo.
 *
 * When no fixture is live, auto-launch a featured replay through the agent
 * (/api/replay). Replay status is polled once app-wide by ReplayMonitor;
 * this hook only orchestrates the one-time auto-launch on the home page.
 */

import { useEffect, useMemo, useRef } from "react";
import type { FixtureWithMatchId } from "@/lib/match/types";
import { listReplayableFixtures } from "@/lib/match/fixtures";
import { useStoppageStore } from "@/store";
import { useReplay } from "@/lib/replay/useReplay";

export type { ReplayStatus } from "@/store/replaySlice";

export interface UseAutoReplayOptions {
  /** When true, a live fixture is in play — do not auto-replay. */
  hasLive: boolean;
  /** All fixtures (used to pick a featured replay). */
  fixtures: FixtureWithMatchId[];
  /** Featured-priority list — if any completed fixture matches, prefer it. */
  preferTeams?: string[];
}

export function useAutoReplay(opts: UseAutoReplayOptions) {
  const { hasLive, fixtures, preferTeams } = opts;
  const blockedIds = useStoppageStore((s) => s.replayBlockedFixtureIds);
  const blocked = useMemo(() => new Set(blockedIds), [blockedIds]);
  const replayable = useMemo(
    () => listReplayableFixtures(fixtures, blocked, preferTeams),
    [fixtures, blocked, preferTeams]
  );
  const { status, launching, error, launch, isActive } = useReplay();
  const autoLaunchedRef = useRef(false);

  useEffect(() => {
    if (hasLive || autoLaunchedRef.current) return;
    if (status?.active) { autoLaunchedRef.current = true; return; }
    if (launching) return;
    const featured = replayable[0];
    if (!featured) return;
    autoLaunchedRef.current = true;
    void launch(featured.FixtureId);
  }, [hasLive, replayable, status?.active, launching, launch]);

  useEffect(() => {
    if (hasLive) autoLaunchedRef.current = true;
  }, [hasLive]);

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
