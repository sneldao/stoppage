"use client";

/**
 * useTickerMonitor — merges internal store data into the unified ticker.
 *
 * Reads from slices already populated by other hooks (activityFeed,
 * agentData, fixtures, markets) and derives TickerItems for the
 * global-ticker. No new fetches — this is pure derivation from store
 * state. External rails (SOL, sports, on-this-day, web headlines) are
 * handled by useTickerEnrichment, which source-whitelists before merge
 * so press copy can never paint as protocol/fixture.
 *
 * Mount ONCE from the layout — every consumer reads tickerItems from
 * the store.
 */

import { useEffect, useRef } from "react";
import { useStoppageStore } from "@/store";
import type { TickerItem } from "@/store/tickerSlice";
import { priorityFor, sortTickerItems } from "@/store/tickerSlice";
import { formatSol } from "@/lib/format";
import { isFixtureLive, isFixtureScheduled, fixtureStartTimeMs } from "@/lib/match/fixtures";
import { relTime } from "@/lib/activity/useActivityFeed";
import { KEYSTONE, keystonePhase, keystoneTimes, keystoneMarketIds } from "@/lib/campaign/keystone";

const TICKER_CAP = 20;

/** Protocol events older than this are stale — a "Live" ticker showing
 *  22-day-old ledger rows reads as a dead feed. The Matchkeeper ledger is
 *  append-only history; freshness filtering belongs at the display layer. */
const PROTOCOL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function timeUntil(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Derive protocol-rail items from the MatchEvent feed. Fresh events only
 *  (24h window), with adjacent duplicate labels collapsed — two ledger rows
 *  for two corners of the same match should not scroll as two items. */
function protocolItems(): TickerItem[] {
  const feed = useStoppageStore.getState().feed;
  const now = Date.now();
  const items: TickerItem[] = [];
  let lastLabel = "";
  for (const e of feed) {
    if (items.length >= 6) break;
    if (now - e.occurredAt > PROTOCOL_MAX_AGE_MS) continue;
    if (e.label === lastLabel) continue;
    lastLabel = e.label;
    items.push({
      id: `protocol:${e.id}`,
      source: "protocol" as const,
      label: e.label,
      ts: e.occurredAt,
      priority: priorityFor("protocol"),
    });
  }
  return items;
}

/** Derive odds-shift items from the agent data slice. */
function oddsItems(): TickerItem[] {
  const shifts = useStoppageStore.getState().oddsShifts;
  return shifts.slice(0, 4).map((s) => ({
    id: `odds:${s.marketId}-${s.toTs}`,
    source: "odds" as const,
    label: `${s.label} ${s.direction === "up" ? "▲" : "▼"} ${Math.round(s.fromYes * 100)}→${Math.round(s.toYes * 100)}¢`,
    ts: s.toTs,
    priority: priorityFor("odds"),
  }));
}

/** Derive fixture items — countdowns for upcoming, scores for live. */
function fixtureItems(): TickerItem[] {
  const fixtures = useStoppageStore.getState().fixtures;
  const scores = useStoppageStore.getState().fixtureScores;
  const now = Date.now();
  const items: TickerItem[] = [];

  for (const f of fixtures) {
    if (isFixtureLive(f)) {
      const score = scores[f.FixtureId];
      if (score) {
        items.push({
          id: `fixture:live:${f.FixtureId}`,
          source: "fixture",
          label: `${f.Participant1} ${score.score.home}–${score.score.away} ${f.Participant2}`,
          ts: score.updatedAt ?? now,
          priority: priorityFor("fixture") + 5, // live scores rank higher
        });
      } else {
        items.push({
          id: `fixture:live:${f.FixtureId}`,
          source: "fixture",
          label: `Live: ${f.Participant1} vs ${f.Participant2}`,
          ts: now,
          priority: priorityFor("fixture") + 5,
        });
      }
    } else if (isFixtureScheduled(f)) {
      const start = fixtureStartTimeMs(f);
      const diff = start - now;
      // Only show upcoming fixtures within the next 4 hours
      if (diff > 0 && diff < 4 * 3_600_000) {
        items.push({
          id: `fixture:upcoming:${f.FixtureId}`,
          source: "fixture",
          label: `${f.Participant1} vs ${f.Participant2} · ${timeUntil(start)}`,
          ts: start,
          priority: priorityFor("fixture"),
        });
      }
    }
  }
  return items.slice(0, 5);
}

/** Derive a pool-total item from the markets slice. */
function poolItem(): TickerItem[] {
  const markets = Object.values(useStoppageStore.getState().markets);
  if (markets.length === 0) return [];
  const locked = markets.reduce((sum, m) => sum + m.yesPool + m.noPool, 0);
  if (locked === 0) return [];
  return [{
    id: "pool:total",
    source: "pool",
    label: `${formatSol(locked)} locked across ${markets.length} market${markets.length === 1 ? "" : "s"}`,
    ts: Date.now(),
    priority: priorityFor("pool"),
  }];
}

/**
 * The campaign match — always in the ticker for the whole window, unlike
 * the generic fixture rail (4h lookahead). Same lifecycle as the banner:
 * disappears once both receipts have landed. Facts come from
 * lib/campaign/keystone.ts; nothing campaign-specific is hardcoded here.
 */
function keystoneItem(): TickerItem[] {
  const now = Date.now();
  const times = keystoneTimes();
  const { txline, attest } = keystoneMarketIds();
  const markets = useStoppageStore.getState().markets;
  const bothSettled =
    markets[txline]?.status === "settled" && markets[attest]?.status === "settled";
  const phase = keystonePhase(now, bothSettled);
  if (phase === "receipts") return [];

  const matchup = `${KEYSTONE.homeTeam} v ${KEYSTONE.awayTeam}`;
  const label =
    phase === "countdown"
      ? `Sat · ${matchup} · betting opens in ${timeUntil(times.bettingOpensMs)}`
      : phase === "betting_open"
      ? `${matchup} · betting open · kickoff in ${timeUntil(times.kickoffMs)}`
      : phase === "in_play"
      ? `LIVE · ${matchup}`
      : `${matchup} FT · settlement proofs landing`;

  return [{
    id: "keystone:cit-cin",
    source: "fixture",
    label,
    // Fresh ts while the campaign is actively progressing, kickoff ts while
    // it's still a countdown — keeps it near the top without outranking
    // genuinely newer protocol events.
    ts: phase === "countdown" || phase === "betting_open" ? now : times.kickoffMs,
    priority: priorityFor("fixture") + 8,
  }];
}

/**
 * Merge internal rails + external items (set by useTickerEnrichment)
 * into a single sorted, deduped, capped list.
 */
function mergeItems(external: TickerItem[]): TickerItem[] {
  const all = [
    ...protocolItems(),
    ...oddsItems(),
    ...fixtureItems(),
    ...keystoneItem(),
    ...poolItem(),
    ...external,
  ];
  const seen = new Set<string>();
  return all
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(sortTickerItems)
    .slice(0, TICKER_CAP);
}

export function useTickerMonitor() {
  // Store data that drives re-derivation.
  const feed = useStoppageStore((s) => s.feed);
  const oddsShifts = useStoppageStore((s) => s.oddsShifts);
  const fixtures = useStoppageStore((s) => s.fixtures);
  const fixtureScores = useStoppageStore((s) => s.fixtureScores);
  const markets = useStoppageStore((s) => s.markets);
  const setTickerItems = useStoppageStore((s) => s.setTickerItems);

  // External items are kept in a ref so the re-derive effect can merge
  // them without depending on a separate state.
  const externalRef = useRef<TickerItem[]>([]);

  // Re-derive whenever any internal slice changes.
  useEffect(() => {
    setTickerItems(mergeItems(externalRef.current));
  }, [feed, oddsShifts, fixtures, fixtureScores, markets, setTickerItems]);

  // Periodic re-derivation for relative-time freshness ("12m" → "11m").
  useEffect(() => {
    const id = window.setInterval(() => {
      setTickerItems(mergeItems(externalRef.current));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [setTickerItems]);

  // Expose a setter for external items so useTickerEnrichment can push
  // SOL price + sports fixtures without a second store subscription.
  return {
    setExternalItems: (items: TickerItem[]) => {
      externalRef.current = items;
      setTickerItems(mergeItems(items));
    },
  };
}
