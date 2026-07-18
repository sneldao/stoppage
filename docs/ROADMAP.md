# Roadmap

Target: TxODDS "Prediction Markets and Settlement" bounty (Superteam Earn,
World Cup track). **Submissions close July 19, 2026 at 23:59 UTC.** Winners
are announced July 29, 2026.

This file is the single status ledger. If something is deployed, broken,
or descoped, it's recorded here and nowhere else.

## Current state (2026-07-18)

- Monorepo builds end to end (web app, SDK, both Anchor programs).
- Program-ID discipline tooling in place and green.
- **Both programs have stable devnet IDs.** Market:
  `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG`, settlement:
  `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF`. Upgrade authority:
  `G33naaudTAyEWFnfLET51aWGNLry5BwUtZt6KwcniFoj`.
- **Settlement proof-receipt upgrade confirmed on devnet.** Deployment tx:
  `39yH8bz6SJbTTqGMfshKqeeYFUFMJYBRdJkpJXjwEr5LFamsf6GmsLNrp2DW6AMDBRrPuSMwSxQFupqS8bARSYjd`.
- **Matching market upgrade confirmed on devnet.** The devnet program account
  reports a later deployment slot (`477002674`) than the settlement program
  (`477000686`), under the expected upgrade authority, with the extended
  program-data account required by `settle_from_proof`.
- **ProtocolConfig initialized on devnet** (fee_bps=25, 0.25%).
  Config PDA: `6zVA5T6ioGfCmPV76bz4mTDUpQSJDAA4zUUMs9PXf9EC`, treasury
  PDA: `5D1G4vg2yPQxZrAFwXb2sR1QLJTjFWSPjUt9d8eSJAxs`.
- **M3 on-chain CPI verified on devnet.** The settlement program's
  `resolve_market` instruction CPIs into TxLINE's `validate_stat` and
  the proof verifies on-chain. Verified with fixture 17952170, seq 941,
  statKey 1002: fixture-level validation passes, stage-1 stat proof
  passes, predicate evaluates to `true`, return data `AQ==` (0x01).
  Devnet tx
  `En879uAi8pGPoUDs6tAhvG6hFLAqMg4XHBXHQrYLpUAoGwkqxFAi3ZHUY6gb8mDN8VNMXgQ5TJYwNeU2C2x8hm1`.
  The settlement program reads the bool return, emits `MarketResolved`
  with the full proof (statement, merkle root, outcome, resolver,
  timestamp), and returns the data to the caller.
- **M1 + M2 contract logic is code-complete and the M2 program test
  suite passes against a local validator (13 passing, 1 pending).** The
  market program implements 12 instructions across session-key
  delegation, market lifecycle, and protocol economics. The settlement
  program's `resolve_market` instruction performs real on-chain CPI
  into TxLINE `validate_stat`, reads the boolean return, and emits a
  proof-carrying `MarketResolved` event.
- **M4 UI is built and redesigned around the live match instrument**:
  home now puts a live TxLINE-backed match snapshot and actionable market
  above the mobile fold; market detail is a continuous match -> stake ->
  receipt flow with session-key timing feedback; market list separates
  local "My form" from the public board. HeliusMonitor hook wires live
  updates into the store. Blinks GET/POST return real market metadata and
  a real unsigned join transaction.
- **@stoppage/txline package complete**: TxLINE API client with auth,
  SSE streaming, historical scores, fixture list, validation proofs,
  and event normalizer. Devnet free-tier subscription refreshed and
  activated with the deployer wallet. Current subscription tx:
  `5spVf6ZmpArg2qwWfLkQGhhxQffUqBpUMtjXjryKpM728gGtRYMUxpm67vjYUKpW14cAE8N1p4KUC9msjArdgwKX`.
  Credentials are stored only in ignored local env/credential files.
- **TxLINE data is now visible in the product surface**: `/api/fixtures`
  powers the home match board, `/api/fixtures/[fixture]/score` exposes
  score/corner/card snapshots, and the local dev server verified both
  endpoints against activated devnet TxLINE credentials.
- **Public proof board route added**: `/api/board` derives a public
  leaderboard from settled/void on-chain positions and market accounts,
  using `SHYFT_API_KEY` server-side when available with public devnet RPC
  fallback. The current devnet board is empty until resolved positions
  exist.
- **Autonomous agent (apps/agent) complete**: connects to TxLINE (live
  SSE or historical replay), normalizes events, creates/settles markets
  on-chain. Fetches TxLINE Merkle proofs before settlement, builds
  `validate_stat` instruction data, includes `resolve_market` (CPI) +
  `settle_from_proof` + `attest_verification` in a single transaction with
  1.4M compute budget. Dry-run replay against the France vs Spain
  semi-final now constructs the proof-gated resolution path for the
  supported total goals and total corners templates; templates without a
  deterministic TxLINE stat-proof mapping are left inactive.
- **Public devnet deployment live.** Web app:
  `https://stoppage.sportwarren.com`. DNS points to `nuncio-vultr`
  (`144.202.117.160`), Traefik terminates HTTPS, and the `stoppage-web`
  Docker service runs on the shared `coolify` network without a host port.
  `/api/fixtures` returns TxLINE fixture data publicly. The autonomous
  keeper runs as PM2 process `stoppage-agent` on the same VPS, using a
  dedicated funded devnet wallet, and is connected to live TxLINE SSE with
  `--live-tx`.
- **Viral mechanics complete**: ShareBar component (tweet generation,
  Blink URL copy, direct link copy), referral tracking via URL params
  + localStorage, tweet generation with market odds + pool size.
- **Retention features complete**: StatsPanel now clearly represents local
  device history as "My form" (W/L record, PnL, streaks), PositionHistory
  (last 10 settled bets), MatchCalendar (upcoming fixtures from TxLINE),
  public ProofBoard, and history slice with localStorage persistence.
- **User delight features complete**: bounded event-driven signal-grid
  animation, visual odds bar (proportional YES/NO bar with transitions),
  LIVE pulse indicator on open markets, mobile-responsive layouts,
  polished proof panel.
- **DRY audit complete**: PREDICATE_LABEL consolidated to SDK, SOL
  formatter consolidated to lib/format.ts, loadCredentials consolidated
  to packages/txline/src/credentials.ts.
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
- Remaining before submission: create/resolve enough devnet activity to
  populate the public board, record the M1 acceptance capture (delegate ->
  close wallet -> ping -> no-popup clip), record the deployed app + TxLINE
  fixture/API walkthrough, publish the demo video, confirm the public GitHub
  repository visibility, and complete the submission writeup/feedback.

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
- [x] `settle_from_proof` (permissionless and requires a TxLINE-verified
      settlement receipt), `void_market` (permissionless after closes_at +
      1h grace), `claim_bond` (creator
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
  settled from a TxLINE proof receipt; winner claims; vault drains to zero;
  loser's claim fails cleanly.

### M3 — TxLINE settlement (target: Jul 19)
The bounty's core ask. Highest external risk — de-risk the unknowns
during M1/M2.
- [x] TxLINE SSE ingestion → normalized event stream (`@stoppage/txline`).
- [x] Predicate evaluator for the launch templates — in
      `apps/agent/src/strategy.ts`. The proof-gated keeper activates only
      `corners_over` and `total_goals_over`; `next_goal_within` and
      `card_shown` remain available as future templates until their TxLINE
      proof mappings are defined.
- [x] Autonomous agent: connects to TxLINE SSE (live or replay),
      creates markets on match start, settles on match events, fetches
      Merkle proofs from TxLINE before settlement, attests verification
      on-chain.
- [x] Agent-side validation: `fetchStatValidation` fetches Merkle proofs
      from TxLINE; agent includes `attest_verification` in the settle tx.
- [x] On-chain CPI into `validate_stat` — **verified on devnet.** The
      settlement program's `resolve_market` instruction CPIs into
      TxLINE's `validate_stat`, reads the boolean return, and emits
      `MarketResolved` with the full proof. The SDK's
      `buildResolveMarketIx` + `buildValidateStatData` handle the borsh
      encoding for all TxLINE types (ScoreStat, StatTerm, ProofNode,
      TraderPredicate, Comparison, BinaryExpression, Option). The agent
      includes `resolve_market` + `settle_from_proof` + `attest_verification`
      in a single transaction with 1.4M compute budget. Devnet
      verification: fixture 17952170, seq 941, statKey 1002 — predicate
      evaluates to `true`, return data `AQ==` (0x01). Devnet tx
      `En879uAi8pGPoUDs6tAhvG6hFLAqMg4XHBXHQrYLpUAoGwkqxFAi3ZHUY6gb8mDN8VNMXgQ5TJYwNeU2C2x8hm1`.
- **Acceptance:** a market settles from a replayed TxLINE event with
  the Merkle proof fetched and verified on-chain via CPI into
  `validate_stat` (agent logs proof node count + value + CPI result),
  and `attest_verification` marks the market as verified on-chain.
  CPI verified on devnet with a known-good fixture. Live agent replay
  against the FRA-SPA fixture requires a rate-limit-free RPC (Helius)
  and the market-program upgrade confirmation for reliable transaction
  landing.

### M4 — Verifiable Resolution UI + market surfaces (target: Jul 19)
- [x] Market list (live + settled) and market detail page; positions and
      claim button; odds/implied probability derived from vault balances.
- [x] Resolution proof panel: `ProofPanel` component shows raw statement,
      Merkle root, outcome, resolver, timestamp, and has a "verify proof
      locally" button that runs client-side Merkle verification via
      `verifyProofLocally` from the SDK. Integrated into the market detail
      page.
- [x] HeliusMonitor wired: settlement/join events update the store live.
- [x] Product surface redesigned around mobile-first direct action:
      live match snapshot above the fold, visible session status, direct
      YES/NO action cells, compact proof language, and measured execution
      receipt for session-key bets.
- [x] Score snapshot route added for fixture-level live scoreboard stats
      using TxLINE score data.
- **Acceptance:** a judge can open a settled market and verify the proof
  themselves without reading code.

### M5 — Blinks + leaderboard + polish (target: Jul 19)
- [x] Blinks GET/POST complete with real market metadata; returns a real
      unsigned join transaction. Unfurl in a wallet-enabled X client
      against devnet still pending (needs the public remote + devnet
      markets).
- [x] Viral mechanics: ShareBar (tweet generation, Blink URL copy, link
      copy), referral tracking via URL params + localStorage.
- [x] Retention: StatsPanel (W/L, PnL, streaks), PositionHistory,
      MatchCalendar (TxLINE fixtures), ProofBoard, history slice with
      localStorage.
- [x] Mobile-width pass; responsive layouts on all pages.
- [x] Visual odds bar, LIVE pulse indicator, polished proof panel.
- [x] Server-side `SHYFT_API_KEY` wired locally and verified against Shyft
      devnet RPC health; free-plan indexed account scans fall back to
      public devnet RPC.

### M6 — Submission (complete by: July 19, 2026 23:59 UTC)
- [ ] Demo video: cold open on the no-popup bet (M1 clip), then settle →
      proof verification → claim. Under 3 minutes.
- [ ] Submission writeup: architecture, what's verifiable and how, honest
      limitations section.
- [ ] README quickstart re-tested on a clean clone.
- [x] Judge-accessible deployed web app:
      `https://stoppage.sportwarren.com`.
- [x] Push repo to remote GitHub (`sneldao/stoppage`).
- [x] Confirm GitHub repository visibility is public from an incognito/non-owner
      session.
- [x] Public app icon for Blinks is present and referenced
      (`/icon-512x512.png`, 512x512 PNG).

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
