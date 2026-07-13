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
Predicate resolver (packages/sdk)  ── evaluates e.g. "goal scored, team=X, before t"
      │
      ▼
Settlement program (programs/settlement)
      │  CPI: validate_stat(match_id, event, merkle_proof)
      ▼
Market program (programs/market)
      │  on verified match: release vault per predicate outcome
      ▼
Web app: position updated, proof receipt shown, leaderboard updated
```

## Session-key delegation (the differentiator)

- User connects wallet once, signs a **delegation transaction** authorizing
  a generated session keypair to act on their behalf within scoped limits
  (max stake per market, expiry, program allowlist = market + settlement
  programs only).
- Session key is held client-side (or in a lightweight enclave/service for
  mobile), never has withdrawal rights beyond placing/claiming positions it
  itself opened.
- Every in-play bet after delegation is signed by the session key directly
  — no wallet popup, no `wallet.signTransaction()` round-trip.
- Delegation is revocable at any time and expires automatically (e.g. end
  of match + settlement window).

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
