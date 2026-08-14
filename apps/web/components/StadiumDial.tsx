"use client";

import { useEffect, useRef } from "react";

/** Four concentric tick-rings. Independent slow wander — opposite bias,
 *  occasional pause or reverse. One canvas; sleeps when the tab is hidden. */
const BANDS = [
  { inner: 0.31, outer: 0.37 },
  { inner: 0.44, outer: 0.50 },
  { inner: 0.57, outer: 0.63 },
  { inner: 0.70, outer: 0.76 },
] as const;

const TICK_STEP = (Math.PI / 180) * 6;
const TICK_HALF = (Math.PI / 180) * 0.5;
const FRAME_MS = 33;

type RingState = {
  angle: number;
  vel: number;
  target: number;
  next: number;
  sign: number;
};

function pickTarget(sign: number, now: number): Pick<RingState, "target" | "next" | "sign"> {
  const roll = Math.random();
  let nextSign = sign;
  let target = 0;
  if (roll < 0.2) {
    target = 0;
  } else {
    if (roll > 0.62) nextSign = -sign;
    target = nextSign * (1.4 + Math.random() * 3.2) * (Math.PI / 180);
  }
  return { target, sign: nextSign, next: now + 3500 + Math.random() * 9000 };
}

function makeRings(now: number): RingState[] {
  return BANDS.map((_, i) => {
    const sign = i % 2 === 0 ? 1 : -1;
    return { angle: Math.random() * Math.PI * 2, vel: sign * 2.2 * (Math.PI / 180), ...pickTarget(sign, now) };
  });
}

export function StadiumDial() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rings = makeRings(performance.now());
    let width = 0;
    let raf = 0;
    let timer = 0;
    let last = performance.now();
    let lastDraw = 0;
    let pageVisible = !document.hidden;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.floor(bounds.width));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(width * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint();
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, width);
      const cx = width / 2;
      const cy = width / 2;
      const radius = width / 2;
      ctx.strokeStyle = "rgba(245, 248, 252, 0.11)";
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
      for (let i = 0; i < BANDS.length; i++) {
        const band = BANDS[i];
        const inner = band.inner * radius;
        const outer = band.outer * radius;
        const a0 = rings[i].angle - TICK_HALF;
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 2; a += TICK_STEP) {
          const t = a0 + a;
          const c = Math.cos(t);
          const s = Math.sin(t);
          ctx.moveTo(cx + c * inner, cy + s * inner);
          ctx.lineTo(cx + c * outer, cy + s * outer);
        }
        ctx.stroke();
      }
    };

    const schedule = (now: number) => {
      if (!pageVisible) return;
      const moving = rings.some((r) => Math.abs(r.vel) > 0.0004);
      const nextFlip = Math.min(...rings.map((r) => r.next));
      if (reduced) return;
      if (moving) {
        raf = requestAnimationFrame(tick);
      } else {
        timer = window.setTimeout(() => {
          raf = requestAnimationFrame(tick);
        }, Math.max(48, nextFlip - now));
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduced) {
        for (let i = 0; i < rings.length; i++) {
          const r = rings[i];
          if (now >= r.next) {
            const next = pickTarget(r.sign, now);
            r.target = next.target;
            r.sign = next.sign;
            r.next = next.next;
          }
          r.vel += (r.target - r.vel) * Math.min(1, dt * 1.4);
          r.angle += r.vel * dt;
        }
      }
      if (now - lastDraw >= FRAME_MS) {
        lastDraw = now;
        paint();
      }
      schedule(now);
    };

    const onVisibility = () => {
      pageVisible = !document.hidden;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (pageVisible) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    if (!reduced) raf = requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="stadium-dial" aria-hidden="true">
      <canvas ref={canvasRef} className="stadium-dial-face" />
    </div>
  );
}
