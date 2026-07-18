"use client";

import { useEffect, type RefObject } from "react";
import type p5 from "p5";

/**
 * Pause a p5 sketch when its canvas is offscreen or the tab is hidden.
 *
 * p5 runs requestAnimationFrame continuously; on mobile three always-on
 * canvases (MatchClock, StoppageClock, ElectricBorder) burn battery and
 * fight scroll. IntersectionObserver + visibilitychange let us loop only
 * when the canvas can actually be seen. Respects prefers-reduced-motion
 * by not auto-starting when offscreen at all.
 */
export function useP5Visibility(
  containerRef: RefObject<HTMLElement | null>,
  p5Ref: RefObject<p5 | null>
) {
  useEffect(() => {
    const container = containerRef.current;
    const sketch = p5Ref.current;
    if (!container || !sketch) return;

    let inView = true;
    let pageVisible = !document.hidden;

    const apply = () => {
      const inst = p5Ref.current;
      if (!inst) return;
      if (inView && pageVisible) {
        inst.loop();
      } else {
        inst.noLoop();
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        apply();
      },
      { rootMargin: "50px" }
    );
    io.observe(container);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVisibility);

    apply();

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [containerRef, p5Ref]);
}
