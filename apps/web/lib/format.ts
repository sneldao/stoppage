/**
 * Shared formatting utilities for the web app.
 *
 * Single source of truth for SOL formatting, market question labels,
 * signing speed display, and country flags (CLAUDE.md rule 6 — DRY).
 */

import { PREDICATE_LABEL, formatPriceMatchId, formatStatement, type MarketPredicate } from "@stoppage/sdk";

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
 * Compact market ref for space-tight surfaces (cards, ticket PNGs, ledger
 * labels). Props keep prop:slug and drop the timestamp; long ids shorten
 * to head…tail.
 */
export function shortMarketRef(matchId: string): string {
  if (isPropMatchId(matchId)) {
    const parts = matchId.split(":");
    const ref = parts.length >= 4 ? `PROP:${parts[1]}:${parts[2]}` : matchId;
    return ref.length > 28 ? `${ref.slice(0, 27)}…` : ref;
  }
  return matchId.length > 24 ? `${matchId.slice(0, 11)}…${matchId.slice(-6)}` : matchId;
}

/**
 * Toast/ticker label for a ledger event. Settlement and void facts carry
 * the structured fields (statement, outcome, matchId) — re-render them
 * here rather than trusting the emitted label, since older ledger rows
 * ship raw machine strings ("price: sol_above:118:1790971200 -> NO").
 * Falls back to the event's own label when nothing parses.
 */
export function eventLabel(e: {
  kind: string;
  label: string;
  matchId?: string;
  statement?: string;
  outcome?: string;
}): string {
  if (e.kind === "settlement_confirmed" && e.statement) {
    const s = formatStatement(e.statement);
    if (s) return `${s} → ${(e.outcome ?? "").toUpperCase() || "SETTLED"}`;
  }
  if ((e.kind === "market_voided" || e.kind === "housekeep_void") && e.matchId) {
    const pretty = formatPriceMatchId(e.matchId);
    if (pretty !== e.matchId) {
      const reason = /\(([^)]*)\)\s*$/.exec(e.label)?.[1];
      return `${pretty} voided${reason ? ` (${reason})` : ""}`;
    }
  }
  return e.label;
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
    const raw = Number(predicate.params.threshold ?? 0) / 1e8;
    const price =
      raw >= 1 ? (Number.isInteger(raw) ? `${raw}` : raw.toFixed(2)) : raw.toPrecision(2);
    // matchId conventions: SYMBOL:<unixTs> (attested windows), SYMBOL:W<isoWeek>
    // (Settled Week), or a bare 64-hex Pyth feed id. Render the symbol and a
    // human suffix — never the raw timestamp or the full feed hash.
    if (/^[0-9a-f]{64}$/i.test(predicate.matchId)) {
      return `${PREDICATE_LABEL[predicate.kind]} $${price} on feed ${predicate.matchId.slice(0, 4)}…${predicate.matchId.slice(-4)}`;
    }
    const [symbol, suffix] = predicate.matchId.split(":");
    let on = symbol;
    if (suffix) {
      if (/^W\d{4}-\d{2}$/.test(suffix)) {
        on = `${symbol} · ${suffix}`;
      } else if (/^\d{9,}$/.test(suffix)) {
        const d = new Date(Number(suffix) * 1000);
        on = `${symbol} · ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
      } else {
        on = `${symbol}:${suffix}`;
      }
    }
    return `${PREDICATE_LABEL[predicate.kind]} $${price} on ${on}`;
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
