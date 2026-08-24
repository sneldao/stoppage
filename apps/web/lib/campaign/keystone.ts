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

// ── Chapter 1 outcome — proof achieved (2026-08-16) ─────────────────
// Static on-chain facts recorded in the ROADMAP settlement ledger.
// Derived PDAs are computed via keystoneMarketIds(); these are the
// verified receipts, not predictions.
export const KEYSTONE_OUTCOME = {
  /** TxLINE-path receipt: settled NO (total goals ≤ 3). */
  txline: {
    outcome: "No" as const,
    settlesAtIso: "2026-08-16T01:48:28Z",
    verifications: 1,
    settleTx:
      "4VH87BkRfRBgPTQEkCcuFnECJNm3Ldaniot6UHeyPp1G4Yc8bBWKo4CdTJ8BMK34e8JDmYEB5k3Vrd8uw4zwJYAs",
    note:
      "Settled by a TxLINE Merkle proof via CPI inside the settlement tx — released without an admin key.",
  },
  /** Operator-attested market: past its observation window, voided + bond reclaimed. */
  attest: {
    voided: true as const,
    note:
      "The operation window expired before a signed observation landed; voided (full refund) and the creation bond reclaimed — by the housekeeper.",
  },
  /** Honest caveat the campaign must keep front-and-center. */
  caveat:
    "Fact check: the Aug 15 keystone settled by proof but carried no real stakes. The point is now proven once with real money on the next one.",
} as const;

// ── Chapter 2: NEXT keystone — the first staked settle ───────────────
// Arsenal v Coventry, EPL (competition 8), Sat 2026-08-21 19:00 UTC.
export const NEXT_KEYSTONE = {
  homeTeam: "Arsenal",
  awayTeam: "Coventry",
  league: "EPL",
  competitionId: 8,
  /** TxLINE fixture id (confirmed in snapshot 2026-08-18). */
  fixtureId: 18146819,
  /** Sat 2026-08-21 19:00 UTC. */
  kickoffMs: Date.UTC(2026, 7, 21, 19, 0, 0),
  bettingOpenOffsetMs: 2 * 60 * 60 * 1000,
  estFullTimeOffsetMs: 2 * 60 * 60 * 1000,
} as const;

/** Matches the keeper's total_goals_over template (threshold 3, TxLINE oracle). */
export const NEXT_KEYSTONE_PREDICATE: MarketPredicate = {
  kind: "total_goals_over",
  matchId: `ARS-COV-${NEXT_KEYSTONE.fixtureId}`,
  params: { team: "", threshold: 3 },
};

/** The derived on-chain market PDA (pre-opened 2026-08-18). */
export function nextKeystoneMarketId(): string {
  const [pda] = findMarketPdaFromPredicate(NEXT_KEYSTONE_PREDICATE);
  return pda.toBase58();
}

export type NextKeystonePhase =
  | "countdown"
  | "betting_open"
  | "in_play"
  | "awaiting_receipts"
  | "receipts"; // settled — receipts on-chain

export function nextKeystonePhase(now: number, bothSettled: boolean): NextKeystonePhase {
  if (bothSettled) return "receipts";
  const open = NEXT_KEYSTONE.kickoffMs - NEXT_KEYSTONE.bettingOpenOffsetMs;
  const ft = NEXT_KEYSTONE.kickoffMs + NEXT_KEYSTONE.estFullTimeOffsetMs;
  if (now < open) return "countdown";
  if (now < NEXT_KEYSTONE.kickoffMs) return "betting_open";
  if (now < ft) return "in_play";
  return "awaiting_receipts";
}

export function nextKeystoneTimes() {
  return {
    bettingOpensMs: NEXT_KEYSTONE.kickoffMs - NEXT_KEYSTONE.bettingOpenOffsetMs,
    kickoffMs: NEXT_KEYSTONE.kickoffMs,
    estFullTimeMs: NEXT_KEYSTONE.kickoffMs + NEXT_KEYSTONE.estFullTimeOffsetMs,
  };
}

// ── Chapter 2 outcome — staked settle achieved (2026-08-21, claimed 2026-08-24) ──
// Static on-chain facts recorded in the ROADMAP settlement ledger
// ("EPL keystone settled + claimed"). Market PDA is derived via
// nextKeystoneMarketId(); these are the verified receipts, not predictions.
export const NEXT_KEYSTONE_OUTCOME = {
  outcome: "No" as const,
  settlesAtIso: "2026-08-21T21:02:10Z",
  verifications: 1,
  /** Both sides staked 0.01 SOL by two separate wallets. */
  stakePerSideSol: 0.01,
  settleTx:
    "ccFfZDHL4H9afcvTgKBiqXHKGHng2Nn6iEphyfPUniEWHFyx5i9Tpva4Bh8vRKxnkj1useZA1Kj1iUfZedkVd6A",
  /** The keeper retried ~25 times (20:50–20:59 UTC) while the TxLINE
   *  validation window opened; the retry queue absorbed it, no human. */
  settleNote:
    "Settled by a TxLINE Merkle proof via CPI — after ~12 minutes of automatic keeper retries while the proof window opened. No admin key touched it.",
  winnerClaimTx:
    "2vfAtd9p2jzLAfMNarieYR3kMqtG6zTefeRHTqHHCVdoyihGCu4jEPwgjT9axWoj3mpgPU3eV74UzxKC9SxvQ9Qm",
  /** Gross 0.02 SOL; 25 bps protocol fee skimmed to treasury on claim. */
  winnerPayoutNote: "Winner claimed 0.01995 SOL (25 bps protocol fee skimmed to the treasury).",
  loserClaimTx:
    "bUkKR9ohdcmJxfaGfEydTHLajw7SHS1cv74VTBDhUJave4UhDFwofSKjzJ9xFGnYFUrpFwn4jxNX8Luf51nJikL",
  loserClaimNote: "The losing side claimed too — cleanly: zero payout, position zeroed on-chain.",
  /** Vault holds exactly the rent-exempt minimum after all claims. */
  vaultNote:
    "The vault drained to exactly its rent-exempt minimum — every lamport left through the proof-gated payout path or the creator bond refund.",
} as const;
