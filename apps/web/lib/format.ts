/**
 * Shared formatting utilities for the web app.
 *
 * Single source of truth for SOL formatting (rule 6 — DRY).
 */

export const LAMPORTS_PER_SOL = 1e9;

/** Format lamports as a human-readable SOL string. */
export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(3)} SOL`;
}
