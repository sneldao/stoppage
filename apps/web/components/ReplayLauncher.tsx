"use client";

import { useEffect } from "react";
import { useReplay } from "@/lib/replay/useReplay";

interface ReplayLauncherProps {
  fixtures: Array<{ FixtureId: number; Participant1: string; Participant2: string; StartTime: string }>;
  onLaunched?: (matchId: string) => void;
  autoLaunchFixtureId?: number | null;
}

export function ReplayLauncher({ fixtures, onLaunched, autoLaunchFixtureId }: ReplayLauncherProps) {
  const { status, launching: busy, error, launch } = useReplay();

  useEffect(() => {
    if (!autoLaunchFixtureId || status?.active) return;
    const exists = fixtures.some((f) => f.FixtureId === autoLaunchFixtureId);
    if (exists) {
      void launch(autoLaunchFixtureId).then((next) => {
        if (next?.matchId) onLaunched?.(next.matchId);
      });
    }
  }, [autoLaunchFixtureId, fixtures, status?.active, launch, onLaunched]);

  const handleLaunch = async (fixtureId: number) => {
    const next = await launch(fixtureId);
    if (next?.matchId) onLaunched?.(next.matchId);
  };

  if (fixtures.length === 0 && !status?.active) return null;

  return (
    <div className="replay-launcher">
      <div className="replay-launcher-head">
        <p className="eyebrow">Replay</p>
        <span className={`replay-status ${status?.active ? "active" : ""}`}>
          {status?.active
            ? `${status.finished ? "Finishing" : "Replaying"} · ${status.homeTeam} v ${status.awayTeam}`
            : "Run a past match through the live pipeline"}
        </span>
      </div>
      {!status?.active && fixtures.length > 0 && (
        <div className="replay-fixture-list">
          {fixtures.slice(0, 4).map((f) => (
            <button
              key={f.FixtureId}
              className="replay-fixture"
              disabled={busy}
              onClick={() => void handleLaunch(f.FixtureId)}
            >
              <strong>{f.Participant1} v {f.Participant2}</strong>
              <span>{new Date(f.StartTime).toLocaleDateString([], { month: "short", day: "numeric" })} · replay →</span>
            </button>
          ))}
        </div>
      )}
      {status?.active && (
        <div className="replay-active-note">
          Markets, odds, and proofs update in real time below as the match replays.
        </div>
      )}
      {error && <p className="replay-error">{error}</p>}
      <style>{`
        .replay-launcher { margin-top: 16px; padding: 16px 18px; border: 1px dashed var(--line); background: rgba(255,255,255,.02); }
        .replay-launcher-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
        .replay-launcher-head .eyebrow { margin: 0; color: var(--amber); }
        .replay-status { font: 500 9px "DM Mono", monospace; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
        .replay-status.active { color: var(--lime); }
        .replay-fixture-list { display: grid; gap: 6px; margin-top: 12px; }
        .replay-fixture { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 12px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; text-align: left; transition: border-color .15s ease, background .15s ease; }
        .replay-fixture:hover:not(:disabled) { border-color: var(--lime); background: rgba(0,255,136,.05); }
        .replay-fixture:disabled { opacity: .5; cursor: wait; }
        .replay-fixture strong { font-size: 12px; }
        .replay-fixture span { font: 500 9px "DM Mono", monospace; color: var(--muted); text-transform: uppercase; white-space: nowrap; }
        .replay-active-note { margin-top: 10px; color: var(--muted); font: 500 9px/1.5 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .04em; }
        .replay-error { margin: 10px 0 0; color: #ff9c91; font-size: 11px; }
      `}</style>
    </div>
  );
}
