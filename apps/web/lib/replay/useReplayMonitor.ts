/**
 * useReplayMonitor — single /api/replay poll for the whole app.
 */

import { useCallback } from "react";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";
import type { ReplayStatus } from "@/store/replaySlice";

const REPLAY_POLL_MS = 5_000;

export function useReplayMonitor() {
  const setReplayStatus = useStoppageStore((s) => s.setReplayStatus);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/replay");
      if (!response.ok) return;
      const data = (await response.json()) as { status?: ReplayStatus };
      setReplayStatus(data.status ?? null);
    } catch {
      // Agent unreachable — leave last known status.
    }
  }, [setReplayStatus]);

  usePollingWhenVisible(poll, REPLAY_POLL_MS, [poll]);
}
