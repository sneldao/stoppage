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
 * flagged over its 60s lookback window. Each shift is a logged signal,
 * matching the TxLINE track's suggested project.
 */
export function SharpMoves() {
  const [shifts, setShifts] = useState<OddsShift[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/odds/shifts");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setShifts(data.shifts ?? []);
        }
      } catch { /* agent offline */ }
    };
    load();
    const id = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (shifts.length === 0) return null;

  return (
    <div className="sharp-moves">
      <div className="sharp-moves-head">
        <p className="eyebrow">Sharp movement</p>
        <span>60s odds shifts ≥ 5%</span>
      </div>
      <ul>
        {shifts.slice(0, 5).map((s) => (
          <li key={`${s.marketId}-${s.toTs}`} className={s.direction === "up" ? "shift-up" : "shift-down"}>
            <span className="shift-arrow">{s.direction === "up" ? "▲" : "▼"}</span>
            <span className="shift-label">{s.label}</span>
            <span className="shift-delta">{s.delta >= 0 ? "+" : ""}{(s.delta * 100).toFixed(0)}%</span>
            <span className="shift-odds">{Math.round(s.fromYes * 100)}→{Math.round(s.toYes * 100)}%</span>
          </li>
        ))}
      </ul>
      <style>{`
        .sharp-moves { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--line); background: #111827; }
        .sharp-moves-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; }
        .sharp-moves-head .eyebrow { margin: 0; color: var(--amber); }
        .sharp-moves-head span { font: 500 8px "DM Mono", monospace; color: var(--muted-dim); text-transform: uppercase; }
        .sharp-moves ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
        .sharp-moves li { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 8px; align-items: center; padding: 7px 0; border-top: 1px solid var(--line); font: 500 10px "DM Mono", monospace; }
        .shift-up .shift-arrow, .shift-up .shift-delta { color: var(--lime); }
        .shift-down .shift-arrow, .shift-down .shift-delta { color: #ff958c; }
        .shift-label { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .shift-delta { font-variant-numeric: tabular-nums; }
        .shift-odds { color: var(--muted); font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}
