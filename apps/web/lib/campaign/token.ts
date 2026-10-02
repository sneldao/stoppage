/**
 * Token launch facts — single source of truth for the countdown.
 *
 * $STOPPAGE is the Clawrena entry ticket: no fee share, no governance,
 * no staking, no promised utility. Change LAUNCH_AT to move the date;
 * set TOKEN_MINT once launched. The banner hides itself when neither
 * applies (no stale countdowns — status claims rot).
 */

export const TOKEN_TICKER = "$STOPPAGE";

/** Launch moment (UTC). Deadline-extended launch; strip hides until TOKEN_MINT is set. */
export const TOKEN_LAUNCH_AT = Date.parse("2026-10-01T04:00:00Z");

/** Entry page (attach token + post here). */
export const TOKEN_ENTRY_URL = "https://clawpump.tech/ansemhack/entry";

/** Mint address once tokenized, else null. */
export const TOKEN_MINT: string | null = "13EDbdEC35pM8GHBxmrHsAtVWbjQuDSn2kKeLtQVh27Q";

export function tokenPageUrl(): string | null {
  return TOKEN_MINT ? `https://clawpump.tech/tokens/${TOKEN_MINT}` : null;
}
