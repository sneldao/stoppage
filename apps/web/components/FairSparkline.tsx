"use client";

import type { QuoteHistoryPoint } from "@/lib/quotes/types";

interface FairSparklineProps {
  points: QuoteHistoryPoint[];
  current: number;
  onchainYes?: number | null;
  width?: number;
  height?: number;
  className?: string;
}

/** Fair-value movement sparkline — shared by pricing panel and calibration rows. */
export function FairSparkline({
  points,
  current,
  onchainYes = null,
  width = 280,
  height = 56,
  className = "",
}: FairSparklineProps) {
  const series =
    points.length > 1
      ? points
      : [{ ts: 0, fairValue: current, bid: current, ask: current, inventorySkew: 0 }];
  const vals = series.map((p) => p.fairValue);
  const min = Math.min(...vals, onchainYes ?? 1);
  const max = Math.max(...vals, onchainYes ?? 0);
  const span = max - min || 1;
  const x = (i: number) => (series.length <= 1 ? width / 2 : (i / (series.length - 1)) * width);
  const y = (v: number) => height - ((v - min) / span) * height;
  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.fairValue).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className={`pricing-spark ${className}`.trim()}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Fair value over time"
    >
      {onchainYes !== null && (
        <line x1={0} x2={width} y1={y(onchainYes)} y2={y(onchainYes)} className="pricing-spark-onchain" />
      )}
      <path d={path} className="pricing-spark-line" />
      <circle cx={x(series.length - 1)} cy={y(current)} r={3} className="pricing-spark-dot" />
    </svg>
  );
}
