import { useCallback } from "react";
import { useStoppageStore } from "@/store";
import type { ReplayStatus } from "@/store/replaySlice";

export function useReplay() {
  const status = useStoppageStore((s) => s.replayStatus);
  const launching = useStoppageStore((s) => s.replayLaunching);
  const error = useStoppageStore((s) => s.replayError);
  const setReplayStatus = useStoppageStore((s) => s.setReplayStatus);
  const setReplayLaunching = useStoppageStore((s) => s.setReplayLaunching);
  const setReplayError = useStoppageStore((s) => s.setReplayError);

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
        setReplayError(data.error ?? "Replay failed to start");
        return null;
      }
      const nextStatus = data.status as ReplayStatus;
      setReplayStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Agent unreachable");
      return null;
    } finally {
      setReplayLaunching(false);
    }
  }, [setReplayError, setReplayLaunching, setReplayStatus]);

  return {
    status,
    launching,
    error,
    launch,
    isActive: Boolean(status?.active),
  };
}
