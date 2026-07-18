"use client";

import { useEffect, useRef } from "react";
import p5 from "p5";

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
      return `90+${Math.ceil(elapsed - 45)}'`;
    }
    case "Extra Time": {
      const m = elapsed + 90;
      if (m <= 105) return `${Math.floor(m)}'`;
      return `105+${Math.ceil(elapsed + 90 - 105)}'`;
    }
    case "Penalties": return "PEN";
    case "Halftime": return "HT";
    case "Full Time": return "FT";
    default: return `${Math.floor(elapsed)}'`;
  }
}

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
      };

      p.draw = () => {
        p.clear();

        const label = phaseRef.current;
        const startedAt = startedAtRef.current;
        const minutes = startedAt ? (Date.now() - startedAt) / 60000 : 0;

        const colorKey = label ?? "1st Half";
        const [main] = PHASE_COLORS[colorKey] ?? ["#3b82f6", "#2563eb"];
        const stopped = label === "Full Time" || label === "Halftime" || label === "Penalties";

        const phaseProgress = stopped ? 1 : Math.min(minutes / 45, 1.5);

        p.push();
        p.translate(cx, cy);
        p.rotate(-p.HALF_PI);

      // — outer glow ring —
      for (let i = 5; i > 0; i--) {
        const alpha = (0.06 - i * 0.01) * 255;
        p.noFill();
        const c = p.color(main);
        c.setAlpha(alpha);
        p.stroke(c);
        p.strokeWeight(2);
        p.circle(0, 0, outerR * 2 + i * 4);
      }

        // — arc track (elapsed) —
        p.noFill();
        p.stroke(p.color(main));
        p.strokeWeight(3);
        p.strokeCap(p.ROUND);
        const arcEnd = stopped ? p.TWO_PI : p.TWO_PI * Math.min(phaseProgress, 1);
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
          tickColor.setAlpha(maxAlpha * (1 - Math.abs(phaseProgress - i / 60) * 3));
          p.stroke(tickColor);
          p.strokeWeight(weight);
          p.line(inner, 0, outer, 0);
          p.pop();
        }

        // — hand —
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

        // — centre dot —
        p.fill(main);
        p.noStroke();
        p.circle(0, 0, 6);
        p.fill(255);
        p.circle(0, 0, 3);
        p.pop();

        // — digital display —
        const timeStr = stopped ? formatMatchTime(colorKey, minutes) : formatMatchTime(colorKey, minutes);
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
          p.fill(255);
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

  return (
    <div
      ref={containerRef}
      className="match-clock"
      style={{ width: size, height: size }}
    />
  );
}
