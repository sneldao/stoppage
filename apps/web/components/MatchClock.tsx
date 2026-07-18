"use client";

import { useEffect, useRef } from "react";
import p5 from "p5";
import { useP5Visibility } from "@/lib/useP5Visibility";

interface MatchClockProps {
  phaseLabel?: string | null;
  phaseStartedAt?: number | null;
  homeTeam?: string;
  awayTeam?: string;
  score?: { home: number; away: number } | null;
  size?: number;
}

const PHASE_COLORS: Record<string, [string, string]> = {
  "1st Half": ["#00ff88", "#00cc6a"],
  "2nd Half": ["#00ff88", "#00cc6a"],
  "Extra Time": ["#f59e0b", "#d97706"],
  Penalties: ["#ef4444", "#dc2626"],
  Halftime: ["#3b82f6", "#2563eb"],
  "Full Time": ["#6366f1", "#4f46e5"],
  Interrupted: ["#ff4444", "#dc2626"],
  Resumed: ["#00ff88", "#00cc6a"],
};

function formatMatchTime(phaseLabel: string, elapsed: number): string {
  switch (phaseLabel) {
    case "1st Half": {
      const m = Math.floor(elapsed);
      if (m <= 45) return `${m}'`;
      return `45+${Math.ceil(elapsed - 45)}'`;
    }
    case "2nd Half": {
      const m = elapsed + 45;
      if (m <= 90) return `${Math.floor(m)}'`;
      return `90+${Math.ceil(m - 90)}'`;
    }
    case "Extra Time": {
      const m = elapsed + 90;
      if (m <= 105) return `${Math.floor(m)}'`;
      return `105+${Math.ceil(m - 105)}'`;
    }
    case "Penalties": return "PEN";
    case "Halftime": return "HT";
    case "Full Time": return "FT";
    default: return `${Math.floor(elapsed)}'`;
  }
}

function isStoppageTime(phaseLabel: string | null | undefined, elapsed: number): boolean {
  if (!phaseLabel) return false;
  if (phaseLabel === "1st Half") return elapsed > 45;
  if (phaseLabel === "2nd Half") return elapsed > 45;
  if (phaseLabel === "Extra Time") return elapsed > 15;
  return false;
}

const STOPPAGE_COLORS: [string, string] = ["#fbbf24", "#f59e0b"];
const DEEP_STOPPAGE_COLORS: [string, string] = ["#ef4444", "#dc2626"];

export function MatchClock({ phaseLabel, phaseStartedAt, homeTeam, awayTeam, score, size = 140 }: MatchClockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5 | null>(null);
  const phaseRef = useRef(phaseLabel);
  const startedAtRef = useRef(phaseStartedAt);
  const scoreRef = useRef(score);
  const homeRef = useRef(homeTeam);
  const awayRef = useRef(awayTeam);

  phaseRef.current = phaseLabel;
  startedAtRef.current = phaseStartedAt;
  scoreRef.current = score;
  homeRef.current = homeTeam;
  awayRef.current = awayTeam;

  useEffect(() => {
    if (!containerRef.current || p5Ref.current) return;

    const s = (p: p5) => {
      const cx = size / 2;
      const cy = size / 2;
      const outerR = size / 2 - 4;
      const innerR = outerR - 12;

      p.setup = () => {
        p.createCanvas(size, size);
        p.pixelDensity(2);
        // Throttle on small screens — the clock only needs ~30fps to read as live.
        if (typeof window !== "undefined" && window.innerWidth < 800) {
          p.frameRate(30);
        }
      };

      p.draw = () => {
        p.clear();

        const label = phaseRef.current;
        const startedAt = startedAtRef.current;
        const minutes = startedAt ? (Date.now() - startedAt) / 60000 : 0;

        const colorKey = label ?? "1st Half";
        const stopped = label === "Full Time" || label === "Halftime" || label === "Penalties";
        const stoppage = !stopped && isStoppageTime(label, minutes);
        const deepStoppage = stoppage && (
          (label === "1st Half" && minutes > 50) ||
          (label === "2nd Half" && minutes > 55) ||
          (label === "Extra Time" && minutes > 20)
        );

        const [main] = deepStoppage
          ? DEEP_STOPPAGE_COLORS
          : stoppage
            ? STOPPAGE_COLORS
            : PHASE_COLORS[colorKey] ?? ["#3b82f6", "#2563eb"];

        const phaseProgress = stopped ? 1 : Math.min(minutes / 45, 1);

        // Stoppage tension: subtle breathing pulse on the whole face
        const tension = stoppage ? 1 + Math.sin(p.millis() / 300) * 0.012 : 1;

        p.push();
        p.translate(cx, cy);
        p.scale(tension);
        p.rotate(-p.HALF_PI);

        // — outer glow ring (stronger in stoppage) —
        const glowLayers = stoppage ? 7 : 5;
        for (let i = glowLayers; i > 0; i--) {
          const alpha = ((stoppage ? 0.09 : 0.06) - i * 0.01) * 255;
          p.noFill();
          const c = p.color(main);
          c.setAlpha(Math.max(alpha, 0));
          p.stroke(c);
          p.strokeWeight(2);
          p.circle(0, 0, outerR * 2 + i * 4);
        }

        // — arc track (elapsed) —
        p.noFill();
        p.stroke(p.color(main));
        p.strokeWeight(3);
        p.strokeCap(p.ROUND);
        const arcEnd = stopped ? p.TWO_PI : p.TWO_PI * phaseProgress;
        p.arc(0, 0, outerR * 2, outerR * 2, 0, arcEnd);

        // — remaining track —
        const dimColor = p.color(main);
        dimColor.setAlpha(30);
        p.stroke(dimColor);
        p.strokeWeight(1.5);
        p.arc(0, 0, outerR * 2, outerR * 2, arcEnd, p.TWO_PI);

        // — tick marks —
        for (let i = 0; i < 60; i++) {
          const angle = (p.TWO_PI / 60) * i;
          const isFive = i % 5 === 0;
          const inner = isFive ? innerR - 4 : innerR;
          const outer = isFive ? innerR + 6 : innerR + 3;
          const weight = isFive ? 2 : 1;
          const maxAlpha = isFive ? 180 : 60;
          p.push();
          p.rotate(angle);
          p.noFill();
          const tickColor = p.color(255);
          tickColor.setAlpha(Math.max(maxAlpha * (1 - Math.abs(phaseProgress - i / 60) * 3), 12));
          p.stroke(tickColor);
          p.strokeWeight(weight);
          p.line(inner, 0, outer, 0);
          p.pop();
        }

        // — minute numerals (5/10/.../60) —
        p.push();
        p.rotate(p.HALF_PI); // undo the global -90 for upright text
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("DM Mono");
        p.textSize(size * 0.062);
        for (let i = 0; i < 12; i++) {
          const angle = (p.TWO_PI / 12) * i - p.HALF_PI;
          const nx = Math.cos(angle) * (innerR - 12);
          const ny = Math.sin(angle) * (innerR - 12);
          const minute = (i + 1) * 5;
          const near = Math.abs(phaseProgress * 60 - (i + 1) * 5) < 3;
          const numColor = near ? p.color(main) : p.color(255, 90);
          p.fill(numColor);
          p.noStroke();
          p.text(minute, nx, ny + 1);
        }
        p.pop();

        // — elapsed hand —
        p.push();
        p.rotate(arcEnd);
        p.noFill();
        p.stroke(main);
        p.strokeWeight(2.5);
        p.line(0, 0, innerR - 4, 0);
        p.fill(main);
        p.noStroke();
        p.circle(innerR - 4, 0, 5);
        p.pop();

        // — ticking second hand (stoppage tension) —
        if (!stopped) {
          const sec = new Date().getSeconds() + new Date().getMilliseconds() / 1000;
          const secAngle = (p.TWO_PI / 60) * sec;
          p.push();
          p.rotate(secAngle);
          p.noFill();
          const secColor = p.color(main);
          secColor.setAlpha(stoppage ? 220 : 110);
          p.stroke(secColor);
          p.strokeWeight(1);
          p.line(0, 0, innerR - 2, 0);
          p.line(0, 0, -(innerR * 0.18), 0);
          p.fill(secColor);
          p.noStroke();
          p.circle(innerR - 2, 0, 3);
          p.pop();
        }

        // — centre dot —
        p.fill(main);
        p.noStroke();
        p.circle(0, 0, 6);
        p.fill(255);
        p.circle(0, 0, 3);
        p.pop();

        // — digital display —
        const timeStr = formatMatchTime(colorKey, minutes);
        p.fill(255);
        p.noStroke();
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(18);
        p.textFont("DM Mono");

        if (label === "Halftime") {
          p.fill(main);
          p.textSize(12);
          p.text("HT", cx, cy);
        } else if (label === "Full Time") {
          p.fill(main);
          p.textSize(12);
          p.text("FT", cx, cy);
        } else if (label === "Penalties") {
          p.fill(main);
          p.textSize(10);
          p.text("PEN", cx, cy);
        } else {
          if (stoppage) {
            p.fill(main);
            p.textSize(15);
          } else {
            p.fill(255);
          }
          p.text(timeStr, cx, cy);
        }

        // — team names + score strip at bottom —
        if (homeRef.current && awayRef.current && scoreRef.current) {
          p.textFont("DM Mono");
          p.textSize(7);
          p.textAlign(p.CENTER, p.TOP);
          p.fill(255, 180);
          const s = scoreRef.current;
          p.text(`${homeRef.current} ${s.home}—${s.away} ${awayRef.current}`, cx, size - 14);
        }
      };
    };

    p5Ref.current = new p5(s, containerRef.current);

    return () => {
      p5Ref.current?.remove();
      p5Ref.current = null;
    };
  }, [size]);

  useP5Visibility(containerRef, p5Ref);

  return (
    <div
      ref={containerRef}
      className="match-clock"
      style={{ width: size, height: size }}
    />
  );
}
