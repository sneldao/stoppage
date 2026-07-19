"use client";

import { useEffect, useRef } from "react";

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Decorative live-data texture. The dither field is deliberately driven by
 * real score updates rather than pointer movement, so it reads as match state.
 */
export function MatchPulse({ live, signalVersion, lastSignalType }: { live: boolean; signalVersion: number; lastSignalType: "goal" | "corner" | "card" | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const rippleStartedAt = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const render = (now: number) => {
      const time = reducedMotion ? 0 : now / 1000;
      const cell = clamp(Math.round(width / 112), 5, 10);
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const centerX = width * .58;
      const centerY = height * .52;
      
      const rippleSpeed = lastSignalType === "goal" ? 1500 : lastSignalType === "card" ? 750 : 950;
      const rippleAge = clamp((now - rippleStartedAt) / rippleSpeed, 0, 1);
      const rippleRadius = rippleAge * Math.max(width, height) * .65;

      context.clearRect(0, 0, width, height);
      context.fillStyle = live ? "#183b58" : "#263c58";
      context.fillRect(0, 0, width, height);

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = column * cell;
          const y = row * cell;
          const dx = (x - centerX) / width;
          const dy = (y - centerY) / height;
          const field = Math.sin((dx * 14) + (time * 1.4)) * .24
            + Math.cos((dy * 17) - (time * .9)) * .17
            + Math.sin((dx + dy) * 22 - time * .55) * .12;
          const distance = Math.hypot(x - centerX, y - centerY);
          const wave = signalVersion > 0
            ? Math.max(0, 1 - Math.abs(distance - rippleRadius) / (cell * 4.5)) * (1 - rippleAge)
            : 0;
          const threshold = BAYER_4X4[(row % 4) * 4 + (column % 4)] / 15;
          const intensity = clamp(.42 + field + wave * .72, 0, 1);

          let cellColor = live ? "rgba(103, 232, 144, .46)" : "rgba(114, 183, 255, .38)";
          if (lastSignalType === "goal") {
            cellColor = "rgba(255, 215, 0, .42)";
          } else if (lastSignalType === "card") {
            cellColor = "rgba(255, 68, 68, .42)";
          } else if (lastSignalType === "corner") {
            cellColor = "rgba(0, 191, 255, .42)";
          }

          let rippleColor = "rgba(255, 213, 106, .82)"; // default gold
          if (lastSignalType === "goal") {
            rippleColor = "rgba(255, 215, 0, .95)";
          } else if (lastSignalType === "card") {
            rippleColor = "rgba(255, 68, 68, .95)";
          } else if (lastSignalType === "corner") {
            rippleColor = "rgba(0, 191, 255, .95)";
          }

          if (intensity > threshold) {
            context.fillStyle = wave > .1 ? rippleColor : cellColor;
            context.fillRect(x, y, cell - 1, cell - 1);
          }
        }
      }

      let lineAlpha = .13;
      let lineColor = "240, 248, 255";
      if (lastSignalType === "goal") {
        lineColor = "255, 215, 0";
        lineAlpha = .38;
      } else if (lastSignalType === "card") {
        lineColor = "255, 68, 68";
        lineAlpha = .38;
      } else if (lastSignalType === "corner") {
        lineColor = "0, 191, 255";
        lineAlpha = .38;
      }

      context.strokeStyle = `rgba(${lineColor}, ${lineAlpha})`;
      context.lineWidth = 1;
      context.strokeRect(width * .08, height * .17, width * .84, height * .66);
      context.beginPath();
      context.moveTo(width * .5, height * .17);
      context.lineTo(width * .5, height * .83);
      context.arc(width * .5, height * .5, Math.min(width, height) * .13, 0, Math.PI * 2);
      context.stroke();

      if (!reducedMotion) animationFrame = window.requestAnimationFrame(render);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    render(performance.now());

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [live, signalVersion, lastSignalType]);

  return <canvas ref={canvasRef} className="match-pulse" aria-hidden="true" />;
}
