/**
 * Keystone campaign — the Aug 15 Orlando City vs FC Cincinnati match that
 * settles the SAME fixture through two different proof paths:
 *
 *   1. TxLINE Merkle proof (devnet validator) — third-party fixture data,
 *      matchId CIT-CIN-17615188, total_goals_over threshold 3. Created
 *      manually with the agent's exact MLS template so Matchkeeper adopts
 *      the same deterministic PDA at match_started (see ROADMAP receipts).
 *   2. Operator attestation (attestation validator) — TheSportsDB event
 *      2406978, matchId tsdb:2406978, total_goals_over threshold 2.
 *
 * One source of truth for the campaign's facts: predicates, timestamps,
 * phases. The /keystone page, the tape chip, and the banner all read
 * from here — no campaign copy or IDs duplicated in components.
 */

import {
  findMarketPdaFromPredicate,
  type MarketPredicate,
} from "@stoppage/sdk";

export const KEYSTONE = {
  /** Display name for the fixture. */
  homeTeam: "Orlando City",
  awayTeam: "FC Cincinnati",
  league: "MLS",
  /** TxLINE fixture id (competition 33). */
  txlineFixtureId: 17615188,
  /** TheSportsDB event id behind the attested market. */
  attestEventId: 2406978,
  /** Kickoff: Sat 2026-08-15 23:30 UTC. */
  kickoffMs: 1786836600000,
  /** Betting gate opens 2h before kickoff (fixture gate rule). */
  bettingOpenOffsetMs: 2 * 60 * 60 * 1000,
  /** Estimated full time — kickoff + 2h. The honest bound for phase copy. */
  estFullTimeOffsetMs: 2 * 60 * 60 * 1000,
  /** TxLINE validation window often opens ~6h after FT (settlement retry
   *  queue exists for exactly this). Receipts copy must promise receipts,
   *  not instant settlement. */
  txlineReceiptMaxDelayMs: 6 * 60 * 60 * 1000,
} as const;

/** The TxLINE proof-path predicate — MUST stay byte-identical to the
 *  on-chain market (and the agent's MLS template in strategy.ts), or the
 *  derived PDA stops matching. */
export const KEYSTONE_TXLINE_PREDICATE: MarketPredicate = {
  kind: "total_goals_over",
  matchId: `CIT-CIN-${KEYSTONE.txlineFixtureId}`,
  params: { team: "", threshold: 3 },
};

/** The operator-attested predicate — MUST stay byte-identical to the
 *  on-chain market (tsdb:2406978). */
export const KEYSTONE_ATTEST_PREDICATE: MarketPredicate = {
  kind: "total_goals_over",
  matchId: `tsdb:${KEYSTONE.attestEventId}`,
  params: { team: "", threshold: 2 },
};

/** Derive both market addresses from the predicates (PDA is deterministic;
 *  never hardcode the market address — derive it). */
export function keystoneMarketIds() {
  const [txline] = findMarketPdaFromPredicate(KEYSTONE_TXLINE_PREDICATE);
  const [attest] = findMarketPdaFromPredicate(KEYSTONE_ATTEST_PREDICATE);
  return {
    txline: txline.toBase58(),
    attest: attest.toBase58(),
    matchIds: {
      txline: KEYSTONE_TXLINE_PREDICATE.matchId,
      attest: KEYSTONE_ATTEST_PREDICATE.matchId,
    },
  };
}

// ── Campaign timeline ─────────────────────────────────────────────────

export type KeystonePhase =
  | "countdown" // before betting opens — capture leads, build the story
  | "betting_open" // 2h before kickoff — both slips live
  | "in_play" // kickoff → estimated full time
  | "awaiting_receipts" // FT passed, settlement proofs landing
  | "receipts"; // both markets settled

export function keystonePhase(now: number, bothSettled: boolean): KeystonePhase {
  if (bothSettled) return "receipts";
  const open = KEYSTONE.kickoffMs - KEYSTONE.bettingOpenOffsetMs;
  const estFt = KEYSTONE.kickoffMs + KEYSTONE.estFullTimeOffsetMs;
  if (now < open) return "countdown";
  if (now < KEYSTONE.kickoffMs) return "betting_open";
  if (now < estFt) return "in_play";
  return "awaiting_receipts";
}

export function keystoneTimes() {
  return {
    bettingOpensMs: KEYSTONE.kickoffMs - KEYSTONE.bettingOpenOffsetMs,
    kickoffMs: KEYSTONE.kickoffMs,
    estFullTimeMs: KEYSTONE.kickoffMs + KEYSTONE.estFullTimeOffsetMs,
    txlineReceiptByMs:
      KEYSTONE.kickoffMs + KEYSTONE.estFullTimeOffsetMs + KEYSTONE.txlineReceiptMaxDelayMs,
  };
}

/** .ics calendar entry (data URI) — a lead-free fallback CTA. */
export function keystoneCalendarHref(): string {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stoppage//Keystone//EN",
    "BEGIN:VEVENT",
    "UID:stoppage-keystone-cit-cin@stoppage.sportwarren.com",
    "DTSTAMP:20260814T000000Z",
    "DTSTART:20260815T233000Z",
    "SUMMARY:Orlando City vs FC Cincinnati — two markets, two proof paths",
    "DESCRIPTION:Same match settles two ways on Stoppage: a TxLINE Merkle-proof market and an operator-attested market. Betting opens 21:30 UTC. https://stoppage.sportwarren.com/keystone",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
