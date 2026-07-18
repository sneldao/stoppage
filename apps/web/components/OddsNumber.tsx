"use client";

import { useEffect, useRef, useState } from "react";

interface OddsNumberProps {
  /** Target probability 0..1 */
  value: number;
  className?: string;
}

/**
 * Animated percentage that eases toward a new value when the odds move.
 * Gives the market a live, ticking feel without a full re-render.
 */
export function OddsNumber({ value, className }: OddsNumberProps) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(value);
  const startRef = useRef(0);

  useEffect(() => {
    if (value === display) return;
    fromRef.current = display;
    startRef.current = performance.now();
    const duration = 450;

    const tick = (now: number) => {
      const t = Math.min((now - startRef.current) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={className}>{Math.round(display * 100)}%</span>;
}
