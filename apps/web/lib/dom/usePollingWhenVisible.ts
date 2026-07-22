import { useEffect, useRef, type DependencyList } from "react";
import { usePageVisible } from "@/lib/dom/usePageVisible";

/**
 * Runs `tick` immediately and on `intervalMs` while the tab is visible.
 * Pauses in background tabs; catches up with one tick when returning.
 */
export function usePollingWhenVisible(
  tick: () => void | Promise<void>,
  intervalMs: number,
  deps: DependencyList = [],
  enabled = true
) {
  const visible = usePageVisible();
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!visible || !enabled) return;
    const run = () => void tickRef.current();
    run();
    const timer = window.setInterval(run, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, enabled, intervalMs, ...deps]);
}
