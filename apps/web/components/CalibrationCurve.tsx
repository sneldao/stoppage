"use client";

import type { CalibrationBucket } from "@stoppage/quant";

interface CalibrationCurveProps {
  buckets: CalibrationBucket[];
  width?: number;
  height?: number;
}

/**
 * Reliability diagram — predicted probability vs empirical YES frequency.
 * Perfect calibration follows the diagonal.
 */
export function CalibrationCurve({ buckets, width = 320, height = 220 }: CalibrationCurveProps) {
  const pad = 28;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (v: number) => pad + v * innerW;
  const y = (v: number) => pad + innerH - v * innerH;

  const active = buckets.filter((b) => b.count > 0);

  return (
    <svg
      className="cal-curve"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Calibration reliability curve"
    >
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} className="cal-curve-axis" />
      <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} className="cal-curve-axis" />
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="cal-curve-perfect" />
      {active.map((bucket) => {
        const cx = x((bucket.lo + bucket.hi) / 2);
        const cy = y(bucket.actual);
        const r = Math.min(10, 4 + bucket.count * 1.5);
        return (
          <g key={`${bucket.lo}-${bucket.hi}`}>
            <circle cx={cx} cy={cy} r={r} className="cal-curve-dot" />
            <title>
              {Math.round(bucket.lo * 100)}–{Math.round(bucket.hi * 100)}% bucket ·{" "}
              predicted {Math.round(bucket.predicted * 100)}% · actual{" "}
              {Math.round(bucket.actual * 100)}% · n={bucket.count}
            </title>
          </g>
        );
      })}
      <text x={x(0.5)} y={height - 6} className="cal-curve-label" textAnchor="middle">
        Predicted P(YES)
      </text>
      <text
        x={10}
        y={y(0.5)}
        className="cal-curve-label"
        textAnchor="middle"
        transform={`rotate(-90 10 ${y(0.5)})`}
      >
        Actual YES rate
      </text>
    </svg>
  );
}
