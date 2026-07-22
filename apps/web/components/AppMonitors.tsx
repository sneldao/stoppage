"use client";

import { useFixturesMonitor } from "@/lib/match/useFixturesMonitor";
import { useOddsHistoryMonitor } from "@/lib/odds/useOddsHistoryMonitor";
import { useReplayMonitor } from "@/lib/replay/useReplayMonitor";
import { useAgentDataMonitor } from "@/lib/agent/useAgentDataMonitor";
import { MarketsRefreshMonitor } from "@/components/MarketsRefreshMonitor";

/** Root-layout data monitors — one mount point for background polling. */
export function AppMonitors() {
  useFixturesMonitor();
  useOddsHistoryMonitor();
  useReplayMonitor();
  useAgentDataMonitor();
  return <MarketsRefreshMonitor />;
}
