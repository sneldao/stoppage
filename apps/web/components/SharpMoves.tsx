"use client";

import { useEffect, useState } from "react";

interface OddsShift {
  marketId: string;
  label: string;
  fromYes: number;
  toYes: number;
  delta: number;
  direction: "up" | "down";
  toTs: number;
}

/**
 * Sharp movement detector — surfaces significant odds shifts the agent
 * flagged over its 60s lookback window. Each shift is a logged signal
 * pulled directly from TxLINE odds data, matching the track's suggested
 * "Sharp Movement Detector" project.
 */
export function SharpMoves() {
  const [shifts, setShifts] = useState<OddsShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/odds/shifts");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setShifts(data.shifts ?? []);
            setLoading(false);
          }
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="sharp-moves">
      <div className="sharp-moves-head">
        <div className="sharp-moves-title-row">
          <p className="eyebrow">Sharp activity</p>
          <span className="sharp-moves-source">via TxLINE</span>
        </div>
        <span className="sharp-moves-window">60s odds shifts ≥ 5%</span>
      </div>

      {loading ? (
        /* Skeleton — prevents layout jump and shows the feature exists */
        <ul className="sharp-moves-skeleton" aria-label="Loading odds shifts">
          {[1, 2, 3].map((n) => (
            <li key={n} className="shift-skeleton-row" aria-hidden="true" />
          ))}
        </ul>
      ) : shifts.length === 0 ? (
        <p className="sharp-moves-empty">
          <span>●</span> No significant movement in the last 60 s
        </p>
      ) : (
        <ul>
          {shifts.slice(0, 5).map((s) => (
            <li
              key={`${s.marketId}-${s.toTs}`}
              className={`shift-row ${s.direction === "up" ? "shift-up" : "shift-down"}`}
            >
              <span className="shift-arrow">{s.direction === "up" ? "▲" : "▼"}</span>
              <span className="shift-label">{s.label}</span>
              <span className="shift-delta">
                {s.delta >= 0 ? "+" : ""}
                {(s.delta * 100).toFixed(0)}%
              </span>
              <span className="shift-odds">
                {Math.round(s.fromYes * 100)}→{Math.round(s.toYes * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .sharp-moves {
          padding: 14px 16px;
          border: 1px solid var(--line);
          background: #111827;
        }
        .sharp-moves-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }
        .sharp-moves-title-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .sharp-moves-title-row .eyebrow {
          margin: 0;
          color: var(--amber);
        }
        .sharp-moves-source {
          font: 500 8px "DM Mono", monospace;
          color: var(--muted-dim);
          text-transform: uppercase;
          letter-spacing: .05em;
          border: 1px solid var(--line);
          padding: 2px 4px;
        }
        .sharp-moves-window {
          font: 500 8px "DM Mono", monospace;
          color: var(--muted-dim);
          text-transform: uppercase;
        }
        .sharp-moves ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .shift-row {
          display: grid;
          grid-template-columns: 14px 1fr auto auto;
          gap: 8px;
          align-items: center;
          padding: 7px 0;
          border-top: 1px solid var(--line);
          font: 500 10px "DM Mono", monospace;
        }
        .shift-up .shift-arrow,
        .shift-up .shift-delta { color: var(--lime); }
        .shift-down .shift-arrow,
        .shift-down .shift-delta { color: #ff958c; }
        .shift-label {
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .shift-delta { font-variant-numeric: tabular-nums; }
        .shift-odds {
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .sharp-moves-empty {
          margin: 0;
          padding: 10px 0 2px;
          border-top: 1px solid var(--line);
          color: var(--muted-dim);
          font: 500 9px "DM Mono", monospace;
          text-transform: uppercase;
          letter-spacing: .04em;
        }
        .sharp-moves-empty span {
          margin-right: 5px;
          color: var(--muted-dim);
          font-size: 7px;
        }
        /* Loading skeleton */
        .sharp-moves-skeleton {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .shift-skeleton-row {
          height: 28px;
          margin-bottom: 1px;
          border-top: 1px solid var(--line);
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,.04) 50%,
            transparent 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.6s infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
