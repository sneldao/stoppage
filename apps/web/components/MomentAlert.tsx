"use client";

import type { ReactNode } from "react";
import type { SignalSnapshot, SignalType } from "@/lib/match/useMatchSignals";

interface MomentAlertProps {
  signalType: SignalType | null;
  signalVersion: number;
  snapshot: SignalSnapshot | null;
  scoringTeam?: string | null;
  /** Optional extra content (e.g. the home hero's your-position line). */
  children?: ReactNode;
  /** Called when the user dismisses the alert early. The auto-clear in
   *  useMatchSignals still runs; dismissal just hides it immediately. */
  onDismiss?: () => void;
}

/**
 * Live moment overlay — the full-bleed edge-glow flash plus the fixed alert
 * card that fires on goals, cards, and corners. Paired with useMatchSignals;
 * shared by the home hero, the match room, and market detail.
 *
 * Honesty rule: this overlay is for REAL live signals. Call sites suppress
 * it during scripted previews and replays (see apps/web/app/page.tsx) so a
 * canned goal never reads as a live feed.
 */
export function MomentAlert({ signalType, signalVersion, snapshot, scoringTeam, children, onDismiss }: MomentAlertProps) {
  if (!signalType) return null;
  return (
    <>
      {/* Full-bleed edge-glow flash in the signal colour */}
      <div key={signalVersion} className={`moment-flash moment-flash--${signalType}`} aria-hidden="true" />
      <div className={`moment-alert moment-alert--${signalType}`} role="alert" aria-live="assertive">
        {onDismiss && (
          <button type="button" className="moment-alert-dismiss" onClick={onDismiss} aria-label="Dismiss live update">
            ×
          </button>
        )}
        <div className="moment-alert-content">
          <span className="moment-alert-badge">⚡ Live update</span>
          <h2>
            {signalType === "goal" && (scoringTeam ? `GOAL — ${scoringTeam} ⚽` : "GOAL SCORED! ⚽")}
            {signalType === "card" && "CARD ISSUED! 🟨"}
            {signalType === "corner" && "CORNER KICK! 🚩"}
          </h2>
          <p>
            {signalType === "goal" && snapshot ? `Score ${snapshot.score.home} — ${snapshot.score.away}` : null}
            {signalType === "card" && snapshot ? `Total cards: ${snapshot.stats.cards}` : null}
            {signalType === "corner" && snapshot ? `Total corners: ${snapshot.stats.corners}` : null}
          </p>
          {children}
          <div className="moment-alert-loading" />
        </div>
      </div>
    </>
  );
}
