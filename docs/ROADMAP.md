# Roadmap

Target: TxODDS "Prediction Markets and Settlement" bounty (Superteam Earn,
World Cup track). Winners announced **July 29, 2026**. ⚠️ The exact
submission cutoff is not stated on the listing — **confirm it via the
TxLINEChat Telegram before planning the final week.** All dates below
assume submission must be complete by ~July 26 and leave buffer.

This file is the single status ledger. If something is deployed, broken,
or descoped, it's recorded here and nowhere else.

## Current state (2026-07-13)

- Monorepo builds end to end (web app, SDK stubs, both Anchor programs).
- Program-ID discipline tooling in place and green.
- **Nothing is deployed to devnet yet.** All SDK functions and program
  instructions are intentional stubs.
- TxLINE unknowns: `validate_stat` program address, proof/leaf format,
  SSE schema, and devnet availability. Blocks M3 — resolve early (ask in
  TxLINEChat while building M1/M2, not after).

## Milestones

Ordered by the demo-video dependency chain, not by ease. Each has an
acceptance test; a milestone without its acceptance test passing on
devnet is not done.

### M1 — Session-key delegation, end to end (target: Jul 15)
The differentiator. Built first because the demo lives or dies on it.
- [ ] `session_grant` state + instructions in `programs/market` (or a
      tiny third program if cleaner): create grant (owner signs once;
      scoped by program allowlist, per-market stake cap, expiry), revoke.
- [ ] SDK `delegateSessionKey` / `signWithSessionKey` / `revokeSessionKey`
      implemented for real (rule 5 in CLAUDE.md).
- [ ] Fund/refund flow for the session key's fee lamports.
- [ ] Devnet deploy via `scripts/deploy.sh`.
- **Acceptance:** on devnet, from the web app: one wallet popup to
  delegate, then a transaction lands signed by the session key with the
  wallet extension closed. Recorded as a screen capture (this clip goes
  straight into the demo video).

### M2 — Market vault: create → join → claim (target: Jul 17)
- [ ] `Market` account + vault PDA, `create_market(predicate, closes_at)`.
- [ ] `join(side, amount)` accepting owner wallet OR valid session grant;
      stake into vault; `Position` PDA per (market, owner).
- [ ] `claim()` gated on settled status; **direct lamport transfers**
      (CLAUDE.md rule 4); pro-rata payout; void/refund path if a market
      never settles by a deadline.
- [ ] Program tests covering: payout math, double-claim, claim-before-
      settle, join-after-close, session-key join with expired/revoked
      grant, stake-cap breach.
- [ ] SDK `joinMarket` / `claimPosition` / `getMarket` real; Blinks POST
      returns a real unsigned join transaction.
- **Acceptance:** two wallets join opposite sides on devnet; market is
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
- [ ] Market list (live + settled) and market detail page; positions and
      claim button; odds/implied probability derived from vault balances.
- [ ] Resolution proof panel: raw statement, Merkle path, anchored root,
      one-click local re-verification ("don't trust us" button).
- [ ] HeliusMonitor wired: settlement/join events update the store live.
- **Acceptance:** a judge can open a settled market and verify the proof
  themselves without reading code.

### M5 — Blinks + leaderboard + polish (target: Jul 25)
- [ ] Blinks GET/POST complete with real market metadata; unfurls in a
      wallet-enabled X client against devnet.
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
