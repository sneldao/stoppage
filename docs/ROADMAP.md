# Roadmap

Target: TxODDS World Cup track (Superteam Earn) — the autonomous
agent/tool track: build a running agent or tool that ingests TxLINE feeds
and executes a defined strategy. **Submissions close July 19, 2026 at
23:59 UTC.** Winners are announced July 29, 2026.

This file is the single status ledger. If something is deployed, broken,
or descoped, it's recorded here and nowhere else.

## Strategic direction

**The product is the settlement primitive, not the betting app.**

The reference UI proves the loop end-to-end (delegate → bet → settle →
prove). The settlement program + SDK are the product surface for
operators. The creative monopoly is narrow: the first settlement
primitive where fund release is cryptographically gated on an on-chain
proof verification for sports markets. Own that market of one, then
expand.

**Expansion path:** more TxLINE stat types (next_goal_within,
card_shown — already scaffolded, need proof mappings) → more oracle
types (the CPI pattern is oracle-agnostic in principle) → more chains.
Each step is a schlep (borsh encoding, proof alignment, CPI path).
The schlep is the moat — if it were easy, Polymarket would already
have proof-gated settlement.

**Post-hackathon identity decision:** the next 3 months look completely
different depending on the answer. If settlement infrastructure: make
the settlement program + SDK consumable by a third party, write the
integration guide, find one betting protocol that wants to use it. If
betting app: get 10 real users through the loop on a real match. The
codebase supports both; the decision determines what to build next.

**Distribution is woven into the product:**
- The proof is the primary marketing artifact. Every settled market
  should produce a shareable proof card (Merkle root, CPI verification,
  settlement tx, fund release — all atomic). This is the thing no
  competitor can produce. Future: "share this proof" feature.
- The `/operators` page is the B2B distribution channel — developer-facing
  pitch with SDK integration snippets and a clear "your markets settle
  like this" demo.
- Blinks make every market a shareable Solana Action. Someone posts a
  market on X, someone else bets without leaving Twitter.
- The "Verify this price" button is a demonstration that doubles as
  marketing — when the price reproduces, the differentiator is felt
  viscerally, not explained abstractly.
- The global ticker is a retention loop — SOL price, live scores, and
  on-this-day sports history keep the page open, increasing the
  probability of conversion.

**Things that don't scale (and should):**
- Matchkeeper as a single PM2 process on one VPS. Proves the loop;
  decentralizing the keeper comes after the CPI path is battle-tested.
- Hand-seeded devnet markets. One real user loop on a real match is
  worth more than 50 seeded markets. Target: one real match in the
  KeeperHub hackathon window (through Aug 13) with real bets and real
  proof-gated settlement.
- Hardcoded launch templates (corners_over, total_goals_over). Don't
  build a general predicate system until two specific predicates have
  settled real markets.

## Current state (2026-07-24)

**Strategic pivot: settlement primitive for operators.** The product is no
longer positioned as a betting app; it's a proof-gated settlement
infrastructure where operators bring their markets and their own oracles.
World Cup data access ended July 19; the creative monopoly is the first
settlement primitive where fund release is cryptographically gated on an
on-chain proof verification. The /operators page, OPERATORS.md, and
OPERATOR_PITCH.md now lead with this positioning.

- **Oracle-agnostic settlement implemented (code-complete, not yet
  deployed).** Settlement program accepts any validator program via
  remaining_accounts[0], with anchor accounts in remaining_accounts[1..].
  No hardcoded TxLINE program IDs or account owners on the contract.
  Market program stores `oracle: Pubkey` on the Market account at creation
  and cross-checks the resolution receipt's `validator_program` against it
  in `settle_from_proof` — a market cannot be settled by a foreign proof.
  Resolution struct now carries validator_program; MarketResolved event
  carries it too. Added `ResolutionOracleMismatch` error.
- **SDK oracle adapter layer.** `packages/sdk/src/oracle.ts` exports
  `txlineOracle` (reference, prepends the 8-byte validate_stat
  discriminator) and `genericOracle` (custom validator, caller supplies
  complete instruction data). `SettlementOracle` interface and
  `buildResolveMarketIxFromOracle` are the operator integration surface.
  `DEFAULT_ORACLE` (TxLINE devnet program id) used by the web app, agent,
  and demo scripts.
- **All call sites updated.** Agent loop, web useMarketActions, and both
  demo scripts pass `oracle: DEFAULT_ORACLE` to buildCreateMarketIx and
  use the new oracle-agnostic buildResolveMarketIx signature
  (validatorProgram + validatorAccounts array + complete validatorIxData).
  buildValidateStatData renamed internally; buildTxlineValidateStatData
  is the public builder (discriminator + args, complete).
- **Operator docs created.** `docs/OPERATORS.md` (integration guide) and
  `docs/OPERATOR_PITCH.md` (one-pager) document the settlement primitive
  positioning, code examples for both TxLINE and custom oracles, and
  current limitations.
- **TypeScript typecheck green.** `npm run typecheck` passes.
- **Anchor build not run in this environment** (Solana toolchain not
  installed). Must run `npm run anchor:build` locally before deploy.
- **Both programs have stable devnet IDs.** Market:
  `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG`, settlement:
  `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF`.
  Upgrade authority: `********************************************`.
- **ProtocolConfig initialized on devnet** (fee_bps=25, 0.25%).
  Config PDA: `6zVA5T6ioGfCmPV76bz4mTDUpQSJDAA4zUUMs9PXf9EC`,
  treasury PDA: `5D1G4vg2yPQxZrAFwXb2sR1QLJTjFWSPjUt9d8eSJAxs`.
- **Public devnet deployment live.** Web app:
  `https://stoppage.sportwarren.com` (Vercel, auto-deploys on push to
  main). Autonomous keeper runs as PM2 process `stoppage-agent` on the
  VPS `nuncio-vultr`, connected to live TxLINE SSE.
- **M1 (session-key delegation) and M2 (market vault) contract logic
  code-complete**, M2 program test suite passes against local validator
  (13 passing, 1 pending). M3 on-chain CPI verified against TxLINE
  fixture 17952170 pre-pivot (devnet tx
  `En879uAi8pGPoUDs6tAhvG6hFLAqMg4XHBXHQrYLpUAoGwkqxFAi3ZHUY6gb8mDN8VNMXgQ5TJYwNeU2C2x8hm1`).
- **TxLINE free-tier subscription** active on devnet; World Cup access
  ended July 19. Mainnet service levels 1 (60s delay) and 12 (real-time)
  available for World Cup & International Friendlies only.

**Remaining before operator-ready:**

1. **Deploy oracle-agnostic programs.** Run `scripts/deploy.sh` locally
   (requires Solana toolchain) to upgrade both programs on devnet.
   Existing devnet markets lack the oracle field and are not compatible
   with the new market program — create fresh markets after deploy.
2. **Re-verify end-to-end settlement.** Run
   `scripts/create-proof-board-demo.ts` against devnet post-deploy to
   confirm the oracle-agnostic CPI path works with TxLINE as the
   reference validator.
3. **Operator pilot.** Find one prediction-market protocol or fantasy
   platform to integrate with a custom validator. The milestone is one
   real operator settling one real market through their own validator,
   not fifty seeded devnet markets.
4. **Mainnet deployment.** Requires legal review (see README compliance
   note) before any funds move to mainnet.
5. **Operator onboarding expansion.** Flesh out `docs/OPERATORS.md`
   with a full integration guide: validator requirements, account
   layout, testing checklist, example validator program.
- **Both programs have stable devnet IDs.** Market:
  `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG`, settlement:
  `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF`. Upgrade authority:
  `G33naaudTAyEWFnfLET51aWGNLry5BwUtZt6KwcniFoj`.
- **Settlement proof-receipt upgrade confirmed on devnet.** Deployment tx:
  `39yH8bz6SJbTTqGMfshKqeeYFUFMJYBRdJkpJXjwEr5LFamsf6GmsLNrp2DW6AMDBRrPuSMwSxQFupqS8bARSYjd`.
  Latest redeploy to match the current SDK/IDL landed in slot `477127963`
  with tx `MX6Mtwtp7aANQHhEE6DpBdX4wyaJXAJMoraKSKfuqKtsTyHaDNVywzfJeyiomBsDrWcQoCv67kSZeBeMu1x1ohB`.
- **Matching market upgrade confirmed on devnet.** The devnet program account
  reports a later deployment slot (`477002674`) than the settlement program
  (`477000686`), under the expected upgrade authority, with the extended
  program-data account required by `settle_from_proof`.
  Latest redeploy landed in slot `477128144` with tx
  `RZpxvUuiy1UHSVzzdNTF3acxbDHmDrBS9g67FNaVB5T2pbe8pxeFibCAF9pYURkMHZ7J3WkzpzKG2hRpXkYfjFt`.
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
  fallback. Devnet demo market
  `ABwKxVtpjUDSchiXQca3dieEurXaXaVN5ZsiiYwDHFLj` anchors the board:
  YES/NO positions created, settled from TxLINE proof tx
  `3mgA3vpM5oXZTQb9KDuXkqYujTocx7dpuJg7SgPEcBgVZF7DVqwFcxg8e3FFZ3BoagzDzHT67d3GhhnWzEGzXybD`,
  and winning claim tx
  `3vwzwCH7XsSRKtKs9P65SpxzD27Ha7ZRPKH696YYu6yoo8DFfGprapYmCDrWd9ndRyncmYc9mUHfsgmLbab4nkYx`.
  Additional seeded devnet proof markets bring the deployed board to
  5 players, 3 verified markets, and 3 attestations.
- **Autonomous agent (apps/agent) complete**: connects to TxLINE (live
  SSE or historical replay), normalizes events, creates/settles markets
  on-chain. Fetches TxLINE Merkle proofs before settlement, builds
  `validate_stat` instruction data, includes `resolve_market` (CPI) +
  `settle_from_proof` + `attest_verification` in a single transaction with
  1.4M compute budget. Dry-run replay against the France vs Spain
  semi-final now constructs the proof-gated resolution path for the
  supported total goals and total corners templates; templates without a
  deterministic TxLINE stat-proof mapping are left inactive.
- **Public devnet deployment live.** Web app (frontend):
  `https://stoppage.sportwarren.com`, served by Vercel (auto-deploys from
  `git push` to `main`). `/api/fixtures` returns TxLINE fixture data
  publicly. The autonomous keeper runs as PM2 process `stoppage-agent` on
  the VPS `nuncio-vultr`, using a dedicated funded
  devnet wallet, and is connected to live TxLINE SSE with `--live-tx`. The
  agent exposes an internal HTTP API on port 18766 that Vercel serverless
  functions reach over the public internet.
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
- **Navigation depth pass complete**: persistent instrument nav shared across
  the match desk, market tape, and focused market views; route transitions
  are short, state-preserving, and keep the live instrument context intact.
- **Frictionless/delight pass complete**: the "no popup" promise now holds
  across tabs — the session keypair persists in `localStorage` and the hook
  resumes a live on-chain `SessionGrant` with zero popups. Onboarding
  collapses from three popups to two by bundling delegation with the first
  wallet-signed bet (opt-in checkbox on the slip). Two distinct opt-outs:
  **Pause** (disable one-tap locally, no popup, reversible) and **End
  session** (on-chain `revoke_session_key`, self-exclude — rule 9). The
  0.1 SOL session fund transfer is disclosed inline on both the bet-slip
  opt-in and the homepage step-3 prompt; the suggested `max_total_stake`
  cap (rule 9) is surfaced as a real nudge with an explicit "No limit"
  opt-out pill, not a silent default. Pause keeps the keypair persisted
  so `revoke` remains reachable from the paused state — the self-exclude
  path is no longer orphaned when one-tap is paused (the previous
  behavior locked the grant's rent until the 6h expiry). `revoke` closes
  the grant and refunds **rent**; the 0.1 SOL `fund_lamports` lives in
  the session keypair's System Program account and is not swept back
  (rule 4 — the market program cannot debit it); a client-side sweep
  signed by the session key is a follow-up, trivial on devnet.
  Bet-slip errors
  moved inline with Retry; claim carries an honest "owner-signed" note
  (the deployed program has no session-claim instruction and the toolchain
  is pinned). Live feed replaces polling for the moments that matter —
  Helius account events push the affected market into the store
  immediately so settlement and odds appear without the 12s poll, and the
  monitor now runs on the market detail page too. The fake "Live data
  connected" text is now a real feed-state badge (Live / Polling / Offline)
  in both the nav and the market detail header. Open-positions banner on
  home and `/markets`; first-fetch skeletons on the tape and the hero
  instrument (replacing ambiguous "no markets" copy during load); match
  sounds get a persisted mute toggle in the nav.
- **Onboarding and system-actor pass complete**: the match desk now leads
  first-time users through wallet -> scoped Fast Session -> first market read.
  Matchkeeper is exposed as the constrained autonomous system actor, with live
  activity plus explicit proof and authority boundaries in the UI.
- **Instrument depth pass complete**: the Fast Session envelope is visible
  before activation, Matchkeeper shows a derived event sequence, focused
  markets retain their proof path, and the tape is filterable/grouped by match.
- **Match control room complete**: `/match` brings the live fixture feed,
  owned positions, fixture-scoped reads, Matchkeeper state, and proof path into
  one operational view. The match desk remains the fast entry surface.
- **Operational confidence pass complete**: market windows now show lifecycle
  state/countdown, proof panels link to the devnet market account, and an open
  position can return directly to Match context.
- **Canonical Matchkeeper activity stream complete**: shared `MatchEvent`
  contract, append-only PM2 keeper ledger, read-only web mount, bounded
  `/api/match-events`, and Explorer-linked real activity in `/match`.
- **Canonical match identity + user activity complete**: fixture API emits the
  same `matchId` used by the agent and market predicates; confirmed local wallet
  positions persist as signature-backed personal activity, distinct from the
  public Matchkeeper ledger.
- **DRY audit complete**: PREDICATE_LABEL consolidated to SDK, SOL
  formatter consolidated to lib/format.ts, loadCredentials consolidated
  to packages/txline/src/credentials.ts.
- **Verifiable quant market-maker layer implemented**: `packages/quant`
  delivers a deterministic, seeded Monte Carlo fair-value engine plus
  confidence-interval market-maker quoting. The model is open-source,
  versioned, and reproducible — the "no black box" keystone.
- **On-chain pricing attestation wired**: `programs/market` stores
  `PricingReceipt` accounts with snapshot hash, model version, fair value,
  bid/ask, agent signature, and timestamp. SDK parses receipts and builds
  `attest_pricing` / `verify_pricing` instructions.
- **Agent publishes verifiable quotes**: `apps/agent` re-prices open markets
  on every TxLINE tick, streams `quote_updated` facts, and attests pricing
  on-chain. The placeholder signature was replaced with a real Ed25519
  signature over the quote fields.
- **Web UI surfaces the no-black-box loop**: `PricingReceiptPanel`
  displays the anchored snapshot hash and model version; the
  "Verify this price" button re-hashes the snapshot, re-runs the open model,
  and confirms the attested fair value reproduces.
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
- Remaining before submission: record the M1 acceptance capture (delegate ->
  close wallet -> ping -> no-popup clip), record the deployed app + TxLINE
  fixture/API walkthrough, record the new "Verify this price" quant flow,
  publish the demo video, confirm the public GitHub repository visibility,
  and complete the submission writeup/feedback.
- **UI/UX consistency pass complete**: the home page's signal-detection
  logic (score-diff → goal/card/corner → `signalVersion` /
  `lastSignalType`) is extracted into a shared `useMatchSignals` hook and
  `MomentAlert` component in `apps/web/lib/match` + `apps/web/components`,
  and now drives event drama across every page that shows a live match.
  `/match` gets real signals into `MatchPulse`, the moment-flash overlay,
  and a compact `LiveInstrument` scoreboard. `/markets` renders odds via
  `OddsNumber` + `OddsSparkline`, flashes rows on odds/pool delta, shows
  live context in match-group headings, and drops the manual "Refresh"
  button. `/markets/[market]` picks up live signals + event flashes.
  `/positions` `OpenPositionCard` uses `OddsNumber` + `OddsSparkline` so
  potential returns feel alive. `/calibration` subscribes to
  `/api/quotes/stream` instead of fetching once, with a flash on fair-value
  update. Also fixed a client-bundle leak where importing `GamePhase` from
  `@stoppage/txline` dragged the node-only `fs` module into the browser —
  `lib/match/fixtures.ts` now uses literal `"FIRST_HALF"` / `"SECOND_HALF"`
  strings. `npm run build` + `npm run check:ids` green.

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
- [ ] Program tests covering: payout math, double-claim, claim-before-
      settle, join-after-close, session-key join with expired/revoked
      grant, cumulative-spend-cap breach, side-mismatch guard, void
      refund path (needs a clock-warp harness). Not yet written — the
      Anchor.toml `test = "npx mocha"` script is configured but no test
      files exist. CLAUDE.md verification bar acknowledges this ("program
      tests once they exist (M2+)"); demo-critical paths are exercised
      end-to-end on devnet instead.
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
- [x] Submission writeup: architecture, what's verifiable and how, honest
      limitations section.
- [ ] README quickstart re-tested on a clean clone.
- [x] Judge-accessible deployed web app:
      `https://stoppage.sportwarren.com`.
- [x] Push repo to remote GitHub (`sneldao/stoppage`).
- [x] Confirm GitHub repository visibility is public from an incognito/non-owner
      session.
- [x] Public app icon for Blinks is present and referenced
      (`/icon-512x512.png`, 512x512 PNG).

## M7 — Agent observability (in progress)

SigNoz / OpenTelemetry for the Matchkeeper keeper. See
[OBSERVABILITY.md](./OBSERVABILITY.md).

- [x] OTel SDK + structured JSON logger in `apps/agent/src/telemetry/`
- [x] Spans around `handleEvent`, `executeAction`, proof fetch, tx submit
- [x] Counters: actions, txline events, proof fetch outcomes
- [x] SigNoz on VPS (Foundry, UI `:9090`, OTLP `:4318`) — `./scripts/install-signoz-vps.sh`
- [x] VPS PM2 env wired (`OTEL_EXPORTER_OTLP_ENDPOINT` in `.env.agent`)
- [x] SigNoz dashboards (match ops, settlement reliability)
- [x] Alerts: settlement failure, SSE gap, proof timeout

## Icebox (explicitly not now)

Recorded so they stop tempting us mid-sprint (see CLAUDE.md → Scope
discipline): SPL-token stakes, AMM/LMSR pricing (vault-ratio odds are
enough for the demo), mainnet anything (legal review first — see README
compliance note), mobile app, ELO/agent-vs-agent markets, market
creation UI for arbitrary predicates (launch templates are hardcoded),
multi-oracle aggregation, AG Grid for position history / market tape /
proof board (sortable tables — `@tanstack/react-table` alternative if
bundle size matters).

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| TxLINE docs/devnet access unclear | Blocks M3 | Ask in TxLINEChat during M1; mock-oracle fallback behind same interface |
| Submission deadline earlier than assumed | Compresses M4–M6 | Confirm deadline this week |
| Session-key scope too ambitious (full on-chain allowlist) | Delays M1 | Minimum viable grant: expiry + stake cap + market-program-only; tighten later |
| Devnet flakiness during recording | Demo risk | Record M1/M3 acceptance clips as they pass, not at the end |
