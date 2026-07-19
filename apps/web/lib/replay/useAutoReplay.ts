/**
 * useAutoReplay — turns dead time into a self-running demo.
 *
 * When no fixture is live, auto-launch a featured replay through the agent
 * (/api/replay). The agent runs a past match through the REAL live pipeline:
 * events stream, the scoreboard ticks, markets open/close, odds move, and
 * proofs verify. LiveMatchBar picks up the replay matchId and streams.
 *
 * One auto-launch per load (a ref guard prevents fights with a manual
 * launch from /match). If a replay is already active (e.g. launched from
 * the match room), this hook just surfaces its status instead of relaunching.
 *
 * Boundary: this is a frontend orchestrator. The agent itself is untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Fixture } from "@stoppage/txline";

export interface ReplayStatus {
  active: boolean;
  fixtureId?: number;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  startedAt?: number;
  finished?: boolean;
}

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
    // GameState 1 = not started, 2/4 = live, 3 = finished (FT). Treat
    // anything that isn't live/upcoming as replay-eligible.
    return s !== 1 && s !== 2 && s !== 4;
  });
  // Prefer a named featured match (e.g. France v Spain semi-final).
  const lowered = preferTeams.map((t) => t.toLowerCase());
  for (const f of completed) {
    const h = (f.Participant1 ?? "").toLowerCase();
    const a = (f.Participant2 ?? "").toLowerCase();
    if (lowered.some((t) => h.includes(t) || a.includes(t))) return f;
  }
  // Else the most recent completed fixture.
  const sorted = [...completed].sort((a, b) => startedTimeMs(b) - startedTimeMs(a));
  return sorted[0] ?? null;
}

export function useAutoReplay(opts: UseAutoReplayOptions) {
  const { hasLive, fixtures, preferTeams } = opts;
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoLaunchedRef = useRef(false);

  // Poll /api/replay for status (also picks up replays launched from /match).
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/replay");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setStatus(data.status ?? null);
        }
      } catch {
        // agent unreachable — leave status as-is
      }
    };
    poll();
    const id = window.setInterval(poll, 5_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const launch = useCallback(async (fixtureId: number) => {
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Replay failed to start");
      } else {
        setStatus(data.status as ReplayStatus);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent unreachable");
    } finally {
      setLaunching(false);
    }
  }, []);

  // Auto-launch once when in dead time.
  useEffect(() => {
    if (hasLive || autoLaunchedRef.current) return;
    if (status?.active) { autoLaunchedRef.current = true; return; }
    if (launching) return;
    const featured = pickFeatured(fixtures, preferTeams);
    if (!featured) return;
    autoLaunchedRef.current = true;
    void launch(featured.FixtureId);
  }, [hasLive, fixtures, status?.active, launching, launch, preferTeams]);

  // Reset the guard when a live match appears, so dead time after it ends
  // can auto-replay again.
  useEffect(() => {
    if (hasLive) autoLaunchedRef.current = true; // don't fight a live match
  }, [hasLive]);

  return {
    status,
    launching,
    error,
    launch,
    isReplay: Boolean(status?.active) && !hasLive,
  };
}

export default useAutoReplay;
