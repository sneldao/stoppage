/**
 * useAutoReplay — turns dead time into a self-running demo.
 *
 * When no fixture is live, auto-launch a featured replay through the agent
 * (/api/replay). Replay status is polled once app-wide by ReplayMonitor;
 * this hook only orchestrates the one-time auto-launch on the home page.
 */

import { useEffect, useRef } from "react";
import type { Fixture } from "@stoppage/txline";
import { useReplay } from "@/lib/replay/useReplay";

export type { ReplayStatus } from "@/store/replaySlice";

export interface UseAutoReplayOptions {
  /** When true, a live fixture is in play — do not auto-replay. */
  hasLive: boolean;
  /** All fixtures (used to pick a featured replay). */
  fixtures: Fixture[];
  /** Featured-priority list — if any completed fixture matches, prefer it. */
  preferTeams?: string[];
}

function startedTimeMs(f: Fixture): number {
  const raw = f.StartTime as unknown;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") return new Date(raw).getTime();
  return 0;
}

function pickFeatured(fixtures: Fixture[], preferTeams: string[] = []): Fixture | null {
  const completed = fixtures.filter((f) => {
    const s = f.GameState as unknown;
    return s !== 1 && s !== 2 && s !== 4;
  });
  const lowered = preferTeams.map((t) => t.toLowerCase());
  for (const f of completed) {
    const h = (f.Participant1 ?? "").toLowerCase();
    const a = (f.Participant2 ?? "").toLowerCase();
    if (lowered.some((t) => h.includes(t) || a.includes(t))) return f;
  }
  const sorted = [...completed].sort((a, b) => startedTimeMs(b) - startedTimeMs(a));
  return sorted[0] ?? null;
}

export function useAutoReplay(opts: UseAutoReplayOptions) {
  const { hasLive, fixtures, preferTeams } = opts;
  const { status, launching, error, launch, isActive } = useReplay();
  const autoLaunchedRef = useRef(false);

  useEffect(() => {
    if (hasLive || autoLaunchedRef.current) return;
    if (status?.active) { autoLaunchedRef.current = true; return; }
    if (launching) return;
    const featured = pickFeatured(fixtures, preferTeams);
    if (!featured) return;
    autoLaunchedRef.current = true;
    void launch(featured.FixtureId);
  }, [hasLive, fixtures, status?.active, launching, launch, preferTeams]);

  useEffect(() => {
    if (hasLive) autoLaunchedRef.current = true;
  }, [hasLive]);

  return {
    status,
    launching,
    error,
    launch,
    isReplay: isActive && !hasLive,
  };
}

export default useAutoReplay;
