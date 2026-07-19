"use client";

import { useEffect, useState } from "react";

interface ReplayStatus {
  active: boolean;
  fixtureId?: number;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  startedAt?: number;
  finished?: boolean;
}

interface ReplayLauncherProps {
  /** Fixtures available to replay (completed / past). */
  fixtures: Array<{ FixtureId: number; Participant1: string; Participant2: string; StartTime: string }>;
  onLaunched?: (matchId: string) => void;
  /** If provided, automatically launch this fixture when it changes. */
  autoLaunchFixtureId?: number | null;
}

export function ReplayLauncher({ fixtures, onLaunched, autoLaunchFixtureId }: ReplayLauncherProps) {
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll replay status while active so the UI reflects completion.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/replay");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setStatus(data.status ?? null);
        }
      } catch { /* agent unreachable */ }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Auto-launch when the parent cycles the fixture id.
  useEffect(() => {
    if (!autoLaunchFixtureId || status?.active) return;
    const exists = fixtures.some((f) => f.FixtureId === autoLaunchFixtureId);
    if (exists) {
      void launch(autoLaunchFixtureId);
    }
  }, [autoLaunchFixtureId, fixtures, status?.active]);

  const launch = async (fixtureId: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Replay failed to start");
      } else {
        const status = data.status as ReplayStatus;
        setStatus(status);
        if (status.matchId) onLaunched?.(status.matchId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent unreachable");
    } finally {
      setBusy(false);
    }
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
              onClick={() => void launch(f.FixtureId)}
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
