"use client";

import { useEffect, useRef } from "react";
import p5 from "p5";
import { useP5Visibility } from "@/lib/useP5Visibility";

interface StoppageClockProps {
  size?: number;
  interactive?: boolean;
  globalPointer?: boolean;
  className?: string;
}

interface SpringPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function makeSpring(x: number, y: number): SpringPoint {
  return { x, y, vx: 0, vy: 0 };
}

function springToward(p: SpringPoint, tx: number, ty: number, stiffness: number, damping: number) {
  p.vx += (tx - p.x) * stiffness;
  p.vy += (ty - p.y) * stiffness;
  p.vx *= damping;
  p.vy *= damping;
  p.x += p.vx;
  p.y += p.vy;
}

export function StoppageClock({ size = 420, interactive = true, globalPointer = false, className }: StoppageClockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5 | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    if (!containerRef.current || p5Ref.current) return;

    const s = (p: p5) => {
      const cx = size / 2;
      const cy = size / 2;
      const faceR = size * 0.42;
      const numeralR = faceR * 0.78;
      // Idle-wander is gated by prefers-reduced-motion — without it the
      // springs settle to center and the centerpiece goes still whenever
      // no pointer is active. The slow Lissajous keeps it breathing with
      // zero external data (the non-contingent baseline).
      const reduceMotion = typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;

      const numeralSprings: SpringPoint[] = [];
      const handSprings: SpringPoint[] = [];
      const NUMERALS = 12;

      p.setup = () => {
        p.createCanvas(size, size);
        p.pixelDensity(2);
        for (let i = 0; i < NUMERALS; i++) {
          numeralSprings.push(makeSpring(cx, cy));
        }
        for (let i = 0; i < 3; i++) {
          handSprings.push(makeSpring(cx, cy));
        }
      };

      p.draw = () => {
        p.clear();

        const pointer = pointerRef.current;
        let targetX = cx;
        let targetY = cy;
        if (interactive && pointer.active) {
          // Clamp so the face never leaves the canvas
          const m = faceR * 0.5;
          targetX = Math.max(m, Math.min(size - m, pointer.x));
          targetY = Math.max(m, Math.min(size - m, pointer.y));
        } else if (!reduceMotion) {
          // Idle wander — slow Lissajous around center so the clock is
          // always gently breathing even with no pointer and no data.
          const t = p.millis();
          targetX = cx + Math.cos(t * 0.00028) * faceR * 0.16;
          targetY = cy + Math.sin(t * 0.00021) * faceR * 0.16;
        }

        // Update springs with increasing lag: numerals fast, hands slower
        const stiffBase = 0.045;
        const damp = 0.82;
        for (let i = 0; i < NUMERALS; i++) {
          springToward(numeralSprings[i], targetX, targetY, stiffBase + i * 0.0015, damp);
        }
        springToward(handSprings[0], targetX, targetY, stiffBase * 0.7, damp);   // hour
        springToward(handSprings[1], targetX, targetY, stiffBase * 0.55, damp);  // minute
        springToward(handSprings[2], targetX, targetY, stiffBase * 0.4, damp);   // second

        // — ambient glow —
        const glowCx = handSprings[2].x;
        const glowCy = handSprings[2].y;
        for (let r = 4; r > 0; r--) {
          p.noFill();
          const c = p.color(0, 255, 136);
          c.setAlpha(4 + r * 2);
          p.stroke(c);
          p.strokeWeight(1);
          p.circle(glowCx, glowCy, faceR * 2 + r * 14);
        }

        // — minute track ring (centered on hour hand position) —
        p.push();
        p.translate(handSprings[0].x, handSprings[0].y);
        p.rotate(-p.HALF_PI);
        p.noFill();
        p.stroke(255, 18);
        p.strokeWeight(1);
        p.circle(0, 0, faceR * 2);
        p.pop();

        // — numerals: football minutes 5,10,...,60 —
        p.push();
        p.translate(0, 0);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("DM Mono");
        p.textSize(size * 0.032);
        for (let i = 0; i < NUMERALS; i++) {
          const angle = (p.TWO_PI / NUMERALS) * i - p.HALF_PI;
          const nx = numeralSprings[i].x + Math.cos(angle) * numeralR;
          const ny = numeralSprings[i].y + Math.sin(angle) * numeralR;
          const minute = (i + 1) * 5;
          p.fill(255, 140);
          p.noStroke();
          p.text(minute, nx, ny);
        }
        p.pop();

        // — tick marks between numerals —
        p.push();
        p.translate(handSprings[0].x, handSprings[0].y);
        p.rotate(-p.HALF_PI);
        for (let i = 0; i < 60; i++) {
          const a = (p.TWO_PI / 60) * i;
          const isFive = i % 5 === 0;
          const inner = faceR * 0.88;
          const outer = isFive ? faceR * 0.96 : faceR * 0.92;
          p.push();
          p.rotate(a);
          p.stroke(255, isFive ? 60 : 24);
          p.strokeWeight(isFive ? 1.5 : 1);
          p.line(inner, 0, outer, 0);
          p.pop();
        }
        p.pop();

        // — hands: real local time —
        const now = new Date();
        const hours = now.getHours() % 12;
        const minutes = now.getMinutes();
        const seconds = now.getSeconds() + now.getMilliseconds() / 1000;

        const hourAngle = p.map(hours + p.norm(minutes, 0, 60), 0, 12, 0, p.TWO_PI) - p.HALF_PI;
        const minuteAngle = p.map(minutes + p.norm(seconds, 0, 60), 0, 60, 0, p.TWO_PI) - p.HALF_PI;
        const secondAngle = p.map(seconds, 0, 60, 0, p.TWO_PI) - p.HALF_PI;

        const handConfig = [
          { len: faceR * 0.5, weight: 3, color: p.color(255, 220) },
          { len: faceR * 0.72, weight: 2, color: p.color(255, 180) },
          { len: faceR * 0.8, weight: 1, color: p.color(0, 255, 136) },
        ];
        const angles = [hourAngle, minuteAngle, secondAngle];

        for (let i = 0; i < 3; i++) {
          const h = handConfig[i];
          const hx = handSprings[i].x;
          const hy = handSprings[i].y;
          p.push();
          p.translate(hx, hy);
          p.rotate(angles[i]);
          p.noFill();
          p.stroke(h.color);
          p.strokeWeight(h.weight);
          p.strokeCap(p.ROUND);
          p.line(0, 0, h.len, 0);
          if (i === 2) {
            // second hand counterweight
            p.line(0, 0, -h.len * 0.22, 0);
            p.fill(h.color);
            p.noStroke();
            p.circle(h.len, 0, 4);
          }
          p.pop();
        }

        // — centre pin —
        p.push();
        p.translate(handSprings[0].x, handSprings[0].y);
        p.fill(255);
        p.noStroke();
        p.circle(0, 0, 5);
        p.fill(0, 255, 136);
        p.circle(0, 0, 2.5);
        p.pop();
      };
    };

    p5Ref.current = new p5(s, containerRef.current);

    return () => {
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, [size, interactive]);

  useEffect(() => {
    if (!interactive || !containerRef.current) return;
    const el = containerRef.current;
    const target: HTMLElement | Window = globalPointer ? window : el;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };
    const onLeave = () => {
      pointerRef.current.active = false;
    };
    target.addEventListener("pointermove", onMove as EventListener);
    el.addEventListener("pointerleave", onLeave);
    if (globalPointer) document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      target.removeEventListener("pointermove", onMove as EventListener);
      el.removeEventListener("pointerleave", onLeave);
      if (globalPointer) document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [interactive, globalPointer]);

  useP5Visibility(containerRef, p5Ref);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, touchAction: interactive ? "none" : "auto" }}
      aria-hidden="true"
    />
  );
}
