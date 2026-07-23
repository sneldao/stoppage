import { useCallback } from "react";
import { useStoppageStore } from "@/store";
import type { ReplayStatus } from "@/store/replaySlice";

const NO_HISTORY = "No historical score data";

export function useReplay() {
  const status = useStoppageStore((s) => s.replayStatus);
  const launching = useStoppageStore((s) => s.replayLaunching);
  const error = useStoppageStore((s) => s.replayError);
  const setReplayStatus = useStoppageStore((s) => s.setReplayStatus);
  const setReplayLaunching = useStoppageStore((s) => s.setReplayLaunching);
  const setReplayError = useStoppageStore((s) => s.setReplayError);
  const markReplayBlocked = useStoppageStore((s) => s.markReplayBlocked);

  const launch = useCallback(async (fixtureId: number) => {
    setReplayLaunching(true);
    setReplayError(null);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error ?? "Replay failed to start";
        setReplayError(message);
        if (response.status === 400 && String(message).includes(NO_HISTORY)) {
          markReplayBlocked(fixtureId);
        }
        return null;
      }
      const nextStatus = data.status as ReplayStatus;
      setReplayStatus(nextStatus);
      return nextStatus;
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : "Agent unreachable");
      return null;
    } finally {
      setReplayLaunching(false);
    }
  }, [markReplayBlocked, setReplayError, setReplayLaunching, setReplayStatus]);

  return {
    status,
    launching,
    error,
    launch,
    isActive: Boolean(status?.active),
  };
}
