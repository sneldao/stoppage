/**
 * Shared formatting utilities for the web app.
 *
 * Single source of truth for SOL formatting, market question labels,
 * signing speed display, and country flags (CLAUDE.md rule 6 — DRY).
 */

import { PREDICATE_LABEL, type MarketPredicate } from "@stoppage/sdk";

export const LAMPORTS_PER_SOL = 1e9;

/** Format lamports as a human-readable SOL string. */
export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(3)} SOL`;
}

/** Operator prop markets carry PROP:<prop>:<slug>:<ts> (legacy PROP:<slug>:<ts>). */
export function isPropMatchId(matchId: string | null | undefined): boolean {
  return !!matchId && matchId.startsWith("PROP:");
}

/**
 * Build a human-readable market question from a predicate.
 * Single source of truth — replaces the 3 local copies that were in
 * page.tsx, match/page.tsx, and markets/[market]/page.tsx.
 */
export function formatMarketQuestion(
  predicate: MarketPredicate,
  opts?: { scoreUnit?: "goals" | "points" }
): string {
  if (isPropMatchId(predicate.matchId)) {
    // Operator prop markets: matchId is PROP:<prop>:<slug>:<ts>
    // (legacy PROP:<slug>:<ts>). The statement is human-readable; render
    // the prop itself, not the price-feed formatting.
    const parts = predicate.matchId.split(":");
    const hasProp = parts.length >= 4;
    const prop = hasProp ? parts[1].replace(/_/g, " ") : null;
    const slug = (hasProp ? parts[2] : parts[1]).replace(/-/g, " ");
    const threshold = Number(predicate.params.threshold ?? 0);
    return hasProp ? `${prop} over ${threshold} · ${slug}` : `${slug} over ${threshold}`;
  }
  if (predicate.kind === "price_above") {
    // threshold is in feed-native units (USD * 1e8 for the Pyth majors)
    const threshold = Number(predicate.params.threshold ?? 0) / 1e8;
    return `${PREDICATE_LABEL[predicate.kind]} $${threshold} on ${predicate.matchId}`;
  }
  const param = predicate.params.windowSeconds ?? predicate.params.threshold ?? "";
  const team = predicate.params.team ? ` for ${predicate.params.team}` : "";
  // US football reuses the total_goals_over predicate (it proves stats 1+2)
  // but the stat carries points — swap the label so NFL markets read right.
  const label =
    predicate.kind === "total_goals_over" && opts?.scoreUnit === "points"
      ? "Total points over"
      : (PREDICATE_LABEL[predicate.kind] ?? predicate.kind);
  return `${label} ${param}${team}`;
}

/**
 * Format a signing speed (in ms) for display.
 * Used in the execution receipt hero card and execution strip.
 */
export function formatSigningSpeed(ms: number): string {
  if (ms < 1) return "<1ms";
  return `${Math.round(ms)}ms`;
}

/**
 * Format confirmation time (submitted → confirmed) for display.
 */
export function formatConfirmationSpeed(submittedAt: number, confirmedAt: number): string {
  const delta = confirmedAt - submittedAt;
  if (delta < 1000) return `${delta}ms`;
  return `${(delta / 1000).toFixed(1)}s`;
}

/** Human countdown to session expiry, e.g. "in 5h 12m", "in 8m", "soon". */
export function formatSessionCountdown(expiresAtMs: number): string {
  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return "soon";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "soon";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

/**
 * Map common country/competition names to flag emoji.
 * Falls back to 🏁 for unmapped values.
 */
const COUNTRY_FLAGS: Record<string, string> = {
  // FIFA country codes (common ones)
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "France": "🇫🇷", "Germany": "🇩🇪", "Spain": "🇪🇸", "Italy": "🇮🇹",
  "Portugal": "🇵🇹", "Netherlands": "🇳🇱", "Belgium": "🇧🇪",
  "Brazil": "🇧🇷", "Argentina": "🇦🇷", "Uruguay": "🇺🇾", "Colombia": "🇨🇴",
  "Mexico": "🇲🇽", "USA": "🇺🇸", "United States": "🇺🇸",
  "Canada": "🇨🇦", "Japan": "🇯🇵", "South Korea": "🇰🇷",
  "Australia": "🇦🇺", "Senegal": "🇸🇳", "Morocco": "🇲🇦",
  "Nigeria": "🇳🇬", "Ghana": "🇬🇭", "Cameroon": "🇨🇲",
  "Croatia": "🇭🇷", "Serbia": "🇷🇸", "Denmark": "🇩🇰",
  "Sweden": "🇸🇪", "Switzerland": "🇨🇭", "Poland": "🇵🇱",
  "Turkey": "🇹🇷", "Austria": "🇦🇹", "Czech Republic": "🇨🇿",
  "Qatar": "🇶🇦", "Saudi Arabia": "🇸🇦", "Iran": "🇮🇷",
  "Ecuador": "🇪🇨", "Costa Rica": "🇨🇷", "Tunisia": "🇹🇳",
  // Competition names
  "World Cup": "🏆", "Champions League": "🏆",
  "Premier League": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "La Liga": "🇪🇸",
  "Serie A": "🇮🇹", "Bundesliga": "🇩🇪", "Ligue 1": "🇫🇷",
};

export function countryFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? "🏁";
}
