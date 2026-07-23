"use client";

import type { Fixture } from "@stoppage/txline";
import { useReplay } from "@/lib/replay/useReplay";

interface ReplayLauncherProps {
  fixtures: Fixture[];
  /** When true, only show status chrome (auto-launch handled elsewhere). */
  autoMode?: boolean;
}

/**
 * Replay controls for the match room — aligned with the home hero's
 * replay-control-strip (amber dashed rail, DM Mono labels).
 */
export function ReplayLauncher({ fixtures, autoMode = false }: ReplayLauncherProps) {
  const { status, launching, error, launch } = useReplay();
  const active = Boolean(status?.active);

  if (!active && fixtures.length === 0) {
    return (
      <div className="replay-control-strip replay-control-strip--idle" aria-live="polite">
        <span className="replay-control-status">
          No finished matches with replay data yet
        </span>
        <span className="replay-control-note">TxLINE historical scores required</span>
      </div>
    );
  }

  if (active) {
    return (
      <div className="replay-control-strip replay-control-strip--active" aria-live="polite">
        <span className="replay-control-status">
          {status?.finished
            ? "Replay settling…"
            : launching
            ? "Starting replay…"
            : `Replay running · ${status?.homeTeam ?? "Home"} v ${status?.awayTeam ?? "Away"}`}
        </span>
        {!autoMode && fixtures.length > 1 && (
          <button
            type="button"
            className="replay-control-switch"
            disabled={launching}
            onClick={() => {
              const currentId = status?.fixtureId;
              const next = fixtures.find((f) => f.FixtureId !== currentId);
              if (next) void launch(next.FixtureId);
            }}
          >
            Switch match →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="replay-launcher-panel" aria-label="Replay a finished match">
      <div className="replay-control-strip replay-control-strip--idle">
        <span className="replay-control-status">
          {autoMode ? "Auto-replay when data is available" : "Run a past match through the live pipeline"}
        </span>
      </div>
      {error && (
        <p className="replay-launcher-error" role="alert">
          {error}
        </p>
      )}
      {!autoMode && fixtures.length > 0 && (
        <div className="replay-fixture-list">
          {fixtures.slice(0, 4).map((f) => (
            <button
              key={f.FixtureId}
              type="button"
              className="replay-fixture"
              disabled={launching}
              onClick={() => void launch(f.FixtureId)}
            >
              <strong>{f.Participant1} v {f.Participant2}</strong>
              <span>
                {new Date(f.StartTime).toLocaleDateString([], { month: "short", day: "numeric" })} · replay →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
