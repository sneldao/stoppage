"use client";

import { useEffect, useRef } from "react";

interface SpinningGroovesProps {
  className?: string;
  /** Number of concentric rings */
  rings?: number;
  /** Base color of the grooves */
  color?: string;
  /** Whether the inner rings should rotate in the opposite direction */
  counterRotate?: boolean;
  /** Slow down or speed up the animation (1 = default) */
  speed?: number;
  /** Size in pixels */
  size?: number;
}

export function SpinningGrooves({
  className = "",
  rings = 5,
  color = "var(--blue)",
  counterRotate = true,
  speed = 1,
  size = 420,
}: SpinningGroovesProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let raf = 0;
    let start = performance.now();
    let inView = true;

    const animate = (now: number) => {
      if (!inView) {
        raf = requestAnimationFrame(animate);
        return;
      }
      const elapsed = (now - start) / 1000;
      const outer = svg.querySelector(".grooves-outer") as SVGGraphicsElement | null;
      const inner = svg.querySelector(".grooves-inner") as SVGGraphicsElement | null;

      if (outer) {
        outer.setAttribute("transform", `rotate(${(elapsed * 6 + 90) * speed} 200 200)`);
      }
      if (inner) {
        inner.setAttribute("transform", `rotate(${-(elapsed * 10) * speed} 200 200)`);
      }

      // Intermittent speed pulse: every ~8s the outer ring briefly accelerates
      const pulse = Math.max(0, Math.sin(elapsed * 0.8) * 0.5 + 0.5);
      const pulseRing = svg.querySelector(".grooves-pulse") as SVGGraphicsElement | null;
      if (pulseRing) {
        const scale = 1 + pulse * 0.04;
        pulseRing.setAttribute("transform", `translate(${200 * (1 - scale)} ${200 * (1 - scale)}) scale(${scale})`);
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
    }, { rootMargin: "50px" });
    io.observe(svg);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [speed]);

  const ringEls = Array.from({ length: rings }, (_, i) => {
    const radius = 40 + i * 28;
    const dash = 12 + i * 4;
    const gap = 18 + i * 3;
    return (
      <circle
        key={i}
        cx="200"
        cy="200"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeDasharray={`${dash} ${gap}`}
        opacity={0.18 - i * 0.025}
        vectorEffect="non-scaling-stroke"
      />
    );
  });

  return (
    <svg
      ref={svgRef}
      className={`spinning-grooves ${className}`}
      viewBox="0 0 400 400"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ color }}
    >
      <g className="grooves-outer" style={{ transformOrigin: "200px 200px" }}>
        {ringEls}
      </g>
      {counterRotate && (
        <g className="grooves-inner" style={{ transformOrigin: "200px 200px" }}>
          {ringEls.slice(0, Math.max(1, Math.floor(rings / 2))).map((el, i) =>
            // Render smaller inner rings with tighter spacing
            <circle
              key={`inner-${i}`}
              cx="200"
              cy="200"
              r={30 + i * 22}
              fill="none"
              stroke={color}
              strokeWidth="1"
              strokeDasharray={`${8 + i * 3} ${14 + i * 2}`}
              opacity={0.12 - i * 0.02}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      )}
      <circle
        className="grooves-pulse"
        cx="200"
        cy="200"
        r="150"
        fill="none"
        stroke={color}
        strokeWidth="1"
        opacity="0.08"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default SpinningGrooves;
