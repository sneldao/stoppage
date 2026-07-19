/**
 * useCountUp — ease a number toward its target from the last displayed
 * value. Shared by SettlementMoment (one-time 0 → payout reveal) and
 * ProofBoard metrics (incremental count-up when a value rises) — one
 * implementation (rule 6).
 */

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, durationMs = 1_000, active = true): number {
  const [val, setVal] = useState(target);
  const valRef = useRef(target);
  useEffect(() => { valRef.current = val; });

  useEffect(() => {
    if (!active) { setVal(target); return; }
    let raf = 0;
    const from = valRef.current;
    if (from === target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, active]);

  return val;
}

