# Roadmap

Target: TxODDS "Prediction Markets and Settlement" bounty (Superteam Earn,
World Cup track). Winners announced **July 29, 2026**. ⚠️ The exact
submission cutoff is not stated on the listing — **confirm it via the
TxLINEChat Telegram before planning the final week.** All dates below
assume submission must be complete by ~July 26 and leave buffer.

This file is the single status ledger. If something is deployed, broken,
or descoped, it's recorded here and nowhere else.

## Current state (2026-07-17)

- Monorepo builds end to end (web app, SDK, both Anchor programs).
- Program-ID discipline tooling in place and green.
- **Both programs deployed to devnet.** Market:
  `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG`, settlement:
  `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF`. Upgrade authority:
  `G33naaudTAyEWFnfLET51aWGNLry5BwUtZt6KwcniFoj`.
- **ProtocolConfig initialized on devnet** (fee_bps=25, 0.25%).
  Config PDA: `6zVA5T6ioGfCmPV76bz4mTDUpQSJDAA4zUUMs9PXf9EC`, treasury
  PDA: `5D1G4vg2yPQxZrAFwXb2sR1QLJTjFWSPjUt9d8eSJAxs`.
- **One demo market created on devnet**: `next_goal_within` for match
  `FRA-ESP`, 600s window, status `open`. Market PDA:
  `8osqxqzwZ2dkiPN5JEvYVKKTd2v8fGiGDLsXffq8QXhG`.
- **M1 + M2 contract logic is code-complete and the M2 program test
  suite passes against a local validator (13 passing, 1 pending).** The
  market program implements 12 instructions across session-key
  delegation, market lifecycle, and protocol economics. The settlement
  program emits a proof-carrying `MarketResolved` event (statement,
  merkle root, outcome, proof hash) — the event shape is finalized even
  though the TxLINE CPI is still a stub.
- **M4 UI is built**: market list (`/markets`), market detail with
  session-key join + wallet join + claim + force-settle + attest +
  Verifiable Resolution panel. HeliusMonitor hook wires live updates
  into the store. Blinks GET/POST return real market metadata and a
  real unsigned join transaction.
- **Tier 1 contract evolution applied** (pre-deploy design review):
  - Protocol fee (25bps default, capped at 5%) skimmed on claim to a
    treasury PDA — investor story.
  - Cumulative spend cap on SessionGrant = loss limit (rule 9) — the
    responsible-design differentiator. UI surfaces it as a feature.
  - Market creation bond (0.01 SOL, refundable on settle/void) — spam
    filter.
  - Settlement event carries the full proof — "proof is the product"
    made literal in the contract.
  - `void_market` (permissionless after grace period) + `attest_verification`
    (permissionless validation counter) — judge-visible.
- **Bug fixed in this pass**: `apply_join` now rejects joining the
  opposite side of an existing position (previously merged both stakes
  into one position recording only the first side). Covered by a test.
- Remaining before submission: M1 acceptance capture (delegate → close
  wallet → ping → no-popup clip), M3 (TxLINE CPI or mock-oracle
  fallback), demo video, public remote.
- TxLINE unknowns: `validate_stat` program address, proof/leaf format,
  SSE schema, and devnet availability. Blocks M3 — resolve early (ask in
  TxLINEChat while building M1/M2, not after).

## Milestones

Ordered by the demo-video dependency chain, not by ease. Each has an
acceptance test; a milestone without its acceptance test passing on
devnet is not done.

### M1 — Session-key delegation, end to end (target: Jul 15)
The differentiator. Built first because the demo lives or dies on it.
- [x] `SessionGrant` account + instructions in `programs/market`:
      `delegate_session_key` (owner signs once; scoped by program
      allowlist, per-market stake cap, **cumulative spend cap = loss
      limit** (rule 9), expiry, fund-lamport transfer), `revoke_session_key`
      (self-exclude path), `session_ping` (verifies grant active).
- [x] SDK `buildDelegateSessionKeyIx` / `buildRevokeSessionKeyIx` /
      `buildSessionPingIx` + `signWithSessionKey` implemented for real
      (rule 5 — signs with the local keypair, never the wallet adapter).
- [x] Fund flow: delegate tx transfers `fund_lamports` owner→session key
      (covers stake capital + tx fees). Refund/sweep of leftover balance
      on revoke is a follow-up; on devnet trivial.
- [x] UI surfaces the loss limit, auto-expiry, and self-exclusion as
      features (responsible design is the differentiator, not a footnote).
- [x] Devnet deploy via `scripts/deploy.sh`.
- [x] **Acceptance:** on devnet, from the web app: one wallet popup to
      delegate, then a transaction lands signed by the session key with
      the wallet extension closed. Verified on devnet — ping tx
      `WXAVMXhtzZmmTCGwAZ6EbeyHGPFFRwcFLhdsYjpJUjv7UXKF4JfCQRtygEbm6wgmjsCtsyzcrZ8MVvMFkfXumni`,
      session key `HAj2QPdJ5pPX3TLMp8saGo2bMXSjYGqozHmcdLSXceEz` as sole
      signer/fee-payer, owner wallet not a signer. Screen capture pending.

### M2 — Market vault: create → join → claim (target: Jul 17)
- [x] `Market` account (market PDA IS the vault — no separate vault
      account), `create_market(kind, match_id, team, param, closes_at)`
      with refundable creation bond (0.01 SOL spam filter).
- [x] `join_via_wallet` and `join_via_session_key` — the latter enforces
      grant validation (not revoked, not expired, owner match, program
      allowlist, **cumulative spend cap** (rule 9), per-market cap) and
      increments `staked_so_far`. Position PDA per (market, owner).
- [x] `claim()` gated on settled/void status; **direct lamport transfers**
      (rule 4); pro-rata payout to winners; protocol fee skimmed to
      treasury PDA; void = full refund, no fee.
- [x] `force_settle` (authority mock for M2 acceptance), `void_market`
      (permissionless after closes_at + 1h grace), `claim_bond` (creator
      refund), `attest_verification` (permissionless validation counter).
- [x] SDK instruction builders for all 12 market instructions; `getMarket`
      fetches + parses on-chain account; `impliedProbability` derives
      odds from vault balances.
- [x] Program tests covering: payout math, double-claim, claim-before-
      settle, join-after-close, session-key join with expired/revoked
      grant, cumulative-spend-cap breach, side-mismatch guard. (Void
      refund path pending — needs a clock-warp harness; see test note.)
- [x] Blinks POST returns a real unsigned join transaction.
- [ ] **Acceptance:** two wallets join opposite sides on devnet; market is
  force-settled by authority (oracle comes in M3); winner claims; vault
  drains to zero; loser's claim fails cleanly.

### M3 — TxLINE settlement (target: Jul 21)
The bounty's core ask. Highest external risk — de-risk the unknowns
during M1/M2.
- [ ] TxLINE SSE ingestion → normalized event stream (`packages/sdk`).
- [ ] Predicate evaluator for the four launch templates
      (`next_goal_within`, `corners_over`, `card_shown`,
      `total_goals_over`).
- [ ] `programs/settlement` `resolve_market`: CPI into `validate_stat`
      with statement + Merkle proof; write outcome + proof reference to
      market state; permissionless keeper can call it.
- [ ] SDK `fetchSettlementProof` + `verifyProofLocally` implemented.
- [ ] Fallback if TxLINE devnet access stalls: an authority-signed
      mock oracle behind the same interface, clearly labeled, so M4/M5
      aren't blocked (descope decision recorded here if used).
- **Acceptance:** a market settles on devnet from a real (or replayed)
  TxLINE event with the proof verified on-chain, and `verifyProofLocally`
  confirms the same proof client-side.

### M4 — Verifiable Resolution UI + market surfaces (target: Jul 23)
- [x] Market list (live + settled) and market detail page; positions and
      claim button; odds/implied probability derived from vault balances.
- [ ] Resolution proof panel: raw statement, Merkle path, anchored root,
      one-click local re-verification ("don't trust us" button). The
      panel shell is built; the proof data lands when M3 settles a real
      market via TxLINE (or the mock-oracle fallback).
- [x] HeliusMonitor wired: settlement/join events update the store live.
- **Acceptance:** a judge can open a settled market and verify the proof
  themselves without reading code. (Blocked on M3 — the panel renders
  mock-settled state today.)

### M5 — Blinks + leaderboard + polish (target: Jul 25)
- [x] Blinks GET/POST complete with real market metadata; returns a real
      unsigned join transaction. Unfurl in a wallet-enabled X client
      against devnet still pending (needs the public remote + devnet
      markets).
- [ ] Settlement-history leaderboard (accuracy per wallet) from settled
      markets.
- [ ] Mobile-width pass; empty/error states on the demo path.

### M6 — Submission (complete by: confirmed deadline, assume ~Jul 26)
- [ ] Demo video: cold open on the no-popup bet (M1 clip), then settle →
      proof verification → claim. Under 3 minutes.
- [ ] Submission writeup: architecture, what's verifiable and how, honest
      limitations section.
- [ ] README quickstart re-tested on a clean clone.
- [ ] Push repo to a public remote (GitHub) — currently local-only.

## Icebox (explicitly not now)

Recorded so they stop tempting us mid-sprint (see CLAUDE.md → Scope
discipline): SPL-token stakes, AMM/LMSR pricing (vault-ratio odds are
enough for the demo), mainnet anything (legal review first — see README
compliance note), mobile app, ELO/agent-vs-agent markets, market
creation UI for arbitrary predicates (launch templates are hardcoded),
multi-oracle aggregation.

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| TxLINE docs/devnet access unclear | Blocks M3 | Ask in TxLINEChat during M1; mock-oracle fallback behind same interface |
| Submission deadline earlier than assumed | Compresses M4–M6 | Confirm deadline this week |
| Session-key scope too ambitious (full on-chain allowlist) | Delays M1 | Minimum viable grant: expiry + stake cap + market-program-only; tighten later |
| Devnet flakiness during recording | Demo risk | Record M1/M3 acceptance clips as they pass, not at the end |
