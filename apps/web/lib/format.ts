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

/**
 * Build a human-readable market question from a predicate.
 * Single source of truth — replaces the 3 local copies that were in
 * page.tsx, match/page.tsx, and markets/[market]/page.tsx.
 */
export function formatMarketQuestion(predicate: MarketPredicate): string {
  const param = predicate.params.windowSeconds ?? predicate.params.threshold ?? "";
  const team = predicate.params.team ? ` for ${predicate.params.team}` : "";
  return `${PREDICATE_LABEL[predicate.kind] ?? predicate.kind} ${param}${team}`;
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
