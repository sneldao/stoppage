# Guided flow — the first staked settle

The product's one-liner is `delegate → bet → settle → prove`. Everything below
is the concrete path for the **next keystone: Arsenal v Coventry (EPL)**, where
we finally check off **M2 acceptance** — two wallets on opposite sides, settled
from a TxLINE proof, winner claims, vault drains to zero.

All devnet. All proof-gated. Devnet SOL is free (faucet). Set a session limit.

---

## The target

- **Fixture:** Arsenal v Coventry, EPL (competition 8), Sat **2026-08-21
  19:00 UTC** — TxLINE fixture **18146819**.
- **Market (pre-opened 2026-08-18):** `F1qU5vZ6ssoK3t8hJzoKcnXuGBEjKrm4G3JQbfN97QEj`
- **Predicate:** total goals over 3, matchId `ARS-COV-18146819`, oracle = TxLINE
  devnet validator. Betting opens 17:00 UTC (kickoff −2h); closes 21:00 UTC.
- Derived / idempotent: `scripts/prep-epl-keystone.ts` re-derives the PDA and
  creates the market with a dedup guard.

## Step 1 — Delegate a session key

Open the app (https://stoppage.sportwarren.com), connect your devnet wallet once,
**Delegate a session key** (one popup). After this, bets sign with the session
key — no popups, frictionless for in-play betting.

- What happened on-chain: a `session_grant` PDA was created with an allowlist,
  per-market cap and a chosen cumulative spend cap (your loss limit).

## Step 2 — Fund the session

The session key holds devnet SOL so it can pay fees **and** place stakes. Fund it
from your wallet (the app's setup prompt offers the exact amount; it must cover
stake + a fee buffer). This `fund_lamports` lives in the session keypair's System
account and is not swept back automatically.

## Step 3 — Place your stake

Back **YES** or **NO** on the Arsenal v Coventry market (goals over 3). Two real
wallets on **opposite sides** is the acceptance shape — get a second person (or a
second wallet) to take the other side so there is a losing pool to flip and a
vault to drain.

- The market vault holds the pools; positions are PDAs per (market, owner).
- Caps and allowlist are enforced in `join_via_session_key`.

## Step 4 — Settle & claim

After full time, TxLINE's validation window usually opens ~6h after FT. The live
keeper (`stoppage-agent`) retries proof fetch and, the moment a Merkle proof is
available, sends the atomic bundle: `resolve_market` CPI → `settle_from_proof` →
`attest_verification`. **No proof, no payment.**

- The winner appears a `claim` (pro-rata share of the losing pool + their stake
  back, minus the 0.25% fee). Losers get nothing; the vault drains to zero.
- Anything still open past closes_at + grace with no proof is auto-voided by the
  housekeeper and bonds/refunds are reclaimed automatically.

## Verify — don't trust

- **Market:** `/markets/<PDA>` — status `settled`, outcome, `verifications`.
- **Receipt:** the settlement tx (logged to the ledger with kind
  `settlement_confirmed`) carries the `merkle_root`; the "Verify" panel re-runs
  the proof and checks the vault release.
- **On-chain:** set `https://api.devnet.solana.com`; load the market account.

## Operator / script view

- Derive + pre-open: `npx tsx scripts/prep-epl-keystone.ts [--create]`
- Housekeep (void + claim): `npx tsx scripts/housekeep.ts --market=<PDA>`
- Settlement is handled by the keeper loop (see docs/ROADMAP.md).

The acceptance gate is recorded in ROADMAP; when it passes (settled + drain to
zero), tick M2.