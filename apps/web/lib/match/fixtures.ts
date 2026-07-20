import type { Fixture } from "@stoppage/txline";

// GamePhase.FirstHalf / GamePhase.SecondHalf (@stoppage/txline). Kept as
// literals here because a value import of the enum pulls txline's node-only
// credentials module (fs) into the client bundle.
const FIRST_HALF = 2;
const SECOND_HALF = 4;

/**
 * A fixture is in play during the first or second half.
 * Single source of truth for "is this match live" across the web app.
 */
export function isFixtureLive(fixture: Fixture | null | undefined): boolean {
  return fixture?.GameState === FIRST_HALF || fixture?.GameState === SECOND_HALF;
}
