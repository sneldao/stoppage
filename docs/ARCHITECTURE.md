# Architecture

This document describes the design. Sequencing, status, and acceptance
criteria live in [ROADMAP.md](./ROADMAP.md); working rules and module
boundaries live in [../CLAUDE.md](../CLAUDE.md). The one sequencing
principle worth restating here: **session-key signing is built first,
end to end** — one real transaction signed by a delegated session key
with no wallet popup. Nothing else matters if that doesn't work on
camera.

## Core flow

```
TxLINE SSE stream
      │
      ▼
@stoppage/txline (packages/txline)  ── auth, SSE, fixtures, validation proofs
      │  normalizes TxLINE events into NormalizedEvent stream
      ▼
Autonomous agent (apps/agent)
      │  evaluates predicates (strategy.ts)
      │  creates markets on match_started
      │  on match_ended: fetches Merkle proof from TxLINE (fetchStatValidation)
      │  submits resolve_market (TxLINE validate_stat CPI), then settles
      ▼
Settlement program + market program
      │  CPI verifies the TxLINE proof and records MarketResolved
      │  creates a resolution receipt; settle_from_proof releases the vault
      │  attest_verification records
      │  an additional public verification counter
      ▼
Web app: position updated, proof receipt shown, stats/history updated
```

### Matchkeeper event ledger

The PM2 keeper writes an append-only NDJSON ledger of observable facts to
`.runtime/match-events.ndjson`. Each `MatchEvent` has a canonical match ID,
timestamp, source, descriptive label, and optional fixture, market, and Solana
signature identifiers. The ledger records TxLINE observations, market creation,
proof preparation, settlement/void confirmation, and failed agent actions.

The web container mounts `.runtime` read-only and serves a bounded filtered
view at `/api/match-events`. It has no write path to the ledger and no ability
to control the agent. `/match` uses this real activity stream for its
Matchkeeper timeline, linking signatures and market accounts to Explorer when
available. The ledger is a deployable devnet observability bridge, not a source
of settlement truth: canonical market state remains on-chain.

Confirmed user positions are recorded separately in the user's browser activity
history with their real transaction signature and are merged into that user's
Match view. This preserves the distinction between public keeper observations
and a wallet's own signed activity without granting the web runtime write access
to the keeper ledger.

### Settlement and proof verification

Settlement is gated by TxLINE's on-chain validation primitive:

1. The agent fetches a Merkle validation proof from TxLINE
   (`fetchStatValidation`) and verifies it locally before submission.
2. In the settlement transaction, `resolve_market` CPIs into TxLINE's
   `validate_stat` instruction and reads its boolean return value.
3. A failed or invalid proof reverts the entire transaction. A valid proof
   creates the one-time `Resolution` receipt PDA and emits a proof-carrying
   `MarketResolved` event.
4. `settle_from_proof` is permissionless but accepts only the canonical
   receipt PDA, owned by the settlement program, whose market and outcome
   match the requested settlement. No authority-only settlement path exists.

The UI exposes the receipt and supports independent local verification, so
users can inspect both the on-chain settlement event and the underlying
TxLINE proof. The agent submits resolution, proof-gated settlement, and the
optional public attestation atomically; a keeper can also safely retry the
last two steps from the immutable receipt after a transient failure.

## Session-key delegation (the differentiator)

- User connects wallet once, signs a **delegation transaction** authorizing
  a generated session keypair to act on their behalf within scoped limits
  (max stake per market, expiry, program allowlist = market + settlement
  programs only).
- The session keypair is persisted in `localStorage` (not `sessionStorage`)
  keyed by the owner wallet. On load the hook checks the chain for a live
  `SessionGrant` matching the restored keypair and resumes one-tap betting
  with **no popup** — opening a new tab no longer silently reverts the user
  to wallet approval. A revoked/expired grant drops the local key so the
  UI never promises one-tap that will fail at signing time.
- Session key is held client-side (or in a lightweight enclave/service for
  mobile), never has withdrawal rights beyond placing/claiming positions it
  itself opened.
- Every in-play bet after delegation is signed by the session key directly
  — no wallet popup, no `wallet.signTransaction()` round-trip.
- Delegation is revocable at any time and expires automatically (e.g. end
  of match + settlement window). Two distinct opt-out paths, both surfaced
  in the bet slip and onboarding prompt:
  - **Pause** — drop the local keypair only. No wallet popup, no on-chain
    revoke. Resume later with one signature. Caps and expiry stay enforced
    on the untouched grant.
  - **End session** — on-chain `revoke_session_key`: closes the grant,
    refunds rent. The self-exclude path; irreversible without a fresh
    delegation. Onboarding collapses the connect / first-bet / delegate
    sequence into two popups by optionally bundling delegation with the
    first wallet-signed bet (a checkbox on the bet slip, on by default).

This is the one piece worth NOT treating as boilerplate. A session key that
is authorized on-chain but never actually signs anything (delegated-in-name-
only) will read as a stub in the demo, not a feature.

## What Stoppage does NOT do

- Does not custody a house book or take the other side of any market.
- Does not use the TxLINE credit token for staking, wagering, or P2P
  transfer (locked to TxODDS per the bounty rules — Stoppage only reads
  the data feed and CPIs into the validation primitive).
- Does not set odds; odds/implied probability are derived from vault
  balances, not quoted by Stoppage.
