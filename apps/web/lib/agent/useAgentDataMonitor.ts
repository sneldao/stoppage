/**
 * useAgentDataMonitor — shared poll for /api/board and /api/odds/shifts.
 *
 * Route-aware: board/shifts only poll on pages that render them.
 */

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { usePollingWhenVisible } from "@/lib/dom/usePollingWhenVisible";
import { useStoppageStore } from "@/store";
import type { BoardData, OddsShift } from "@/store/agentDataSlice";

const BOARD_POLL_MS = 15_000;
const SHIFTS_POLL_MS = 10_000;

function needsBoard(pathname: string) {
  return pathname === "/" || pathname.startsWith("/markets");
}

function needsShifts(pathname: string) {
  return pathname === "/" || pathname.startsWith("/match") || pathname.startsWith("/markets");
}

export function useAgentDataMonitor() {
  const pathname = usePathname();
  const setBoard = useStoppageStore((s) => s.setBoard);
  const setOddsShifts = useStoppageStore((s) => s.setOddsShifts);
  const pollBoard = needsBoard(pathname);
  const pollShifts = needsShifts(pathname);

  const loadBoard = useCallback(async () => {
    try {
      const response = await fetch("/api/board");
      if (!response.ok) {
        setBoard(null, true);
        return;
      }
      const data = (await response.json()) as BoardData;
      setBoard(data, false);
    } catch {
      setBoard(null, true);
    }
  }, [setBoard]);

  const loadShifts = useCallback(async () => {
    try {
      const response = await fetch("/api/odds/shifts");
      if (!response.ok) {
        setOddsShifts([], false);
        return;
      }
      const data = (await response.json()) as { shifts?: OddsShift[] };
      setOddsShifts(data.shifts ?? [], false);
    } catch {
      setOddsShifts([], false);
    }
  }, [setOddsShifts]);

  usePollingWhenVisible(loadBoard, BOARD_POLL_MS, [loadBoard], pollBoard);
  usePollingWhenVisible(loadShifts, SHIFTS_POLL_MS, [loadShifts], pollShifts);
}
