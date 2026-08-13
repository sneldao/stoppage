"use client";

import { useReplay } from "@/lib/replay/useReplay";

/**
 * Replay status chrome for the match room's auto-replay rotation
 * (useMatchRoomReplay launches; this just narrates the state). Returns
 * nothing until a replay is actually running or starting — before that,
 * the scoreboard's idle line is the single empty state.
 */
export function ReplayLauncher() {
  const { status, launching } = useReplay();
  const active = Boolean(status?.active);

  if (!active && !launching) return null;

  return (
    <div className="replay-control-strip replay-control-strip--active" aria-live="polite">
      <span className="replay-control-status">
        {status?.finished
          ? "Replay settling…"
          : launching
          ? "Starting replay…"
          : `Replay running · ${status?.homeTeam ?? "Home"} v ${status?.awayTeam ?? "Away"}`}
      </span>
    </div>
  );
}
