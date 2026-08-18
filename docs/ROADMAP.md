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
  proof-gated settlement. (Amended 2026-08-10: free-tier TxLINE has no
  live coverage until Sept 23, so this window is served by the
  attestation oracle instead — Orlando City vs FC Cincinnati, Aug 15.
  Operator-attested, not TxODDS-verified; say so wherever it's shown.
  Amended 2026-08-13: free/devnet TxLINE now includes MLS — see Current
  state below. Aug 15 is dual-oracle: TxLINE + attestation on the same
  fixture.)
- Hardcoded launch templates (corners_over, total_goals_over). Don't
  build a general predicate system until two specific predicates have
  settled real markets.

## Current state (2026-08-13)

**TxLINE free/devnet now includes MLS — the Aug 10 "MLS is 403" finding
was a wrong-ID false negative.** Live probe against `txline-dev` with
project credentials: MLS is competitionId **33**, not 1480 (1480 still
403 "not in your bundle" — it is not MLS). Snapshot: 415 fixtures. MLS
77 fixtures, first kickoff 2026-08-15 23:30 UTC (Orlando City vs FC
Cincinnati, fixtureId **17615188**, plus four simultaneous MLS
kickoffs). Premier League is competitionId **8** with 280 fixtures,
earliest Arsenal vs Coventry 2026-08-21 19:00 UTC. Friendlies (430, 26
fixtures) unchanged. Free service levels 1 and 12 list "MLS, World Cup
& Int Friendlies". The schedule docs page is slightly stale against the
API — trust the API. Competition IDs live in
`packages/txline` `Competition` enum (single source of truth).

**Repo wired for MLS (2026-08-13).** `Competition` enum +
`fetchFixturesForCompetitions` / free-bundle `/api/fixtures` filter;
fixture-scoped matchIds (`City-Cincinnati-17615188` shape);
`TXLINE_COMPETITIONS` / `--competitions=` agent filter (dry-run
confirmed `Loaded 77/415 fixtures (filtered): MLS=77`); MLS templates
goals-only until corners proven; settlement retry queue for the ~6h
proof window; homepage prefers TxLINE league countdown. No finished MLS
fixture in the rolling replay window yet (expected pre-Aug-15) — corners
verdict deferred to post-match capture of 17615188.

**Keystone reset: the soonest third-party-verified live settle is Aug 15
MLS via TxLINE**, not Sept 23 Friendlies. Planned: goals-over-3 market
on fixture 17615188, oracle = TxLINE devnet validator, real second-wallet
session-key bet, settle from Merkle proof (retry queue — validation
often opens ~6h after FT). Tx signatures recorded here after the run.

**Keystone market created (2026-08-13).** Fixture confirmed via TxLINE
devnet API: Orlando City vs FC Cincinnati, FixtureId 17615188,
CompetitionId 33 (MLS), kickoff 2026-08-15 23:30 UTC,
matchId `CIT-CIN-17615188` (matchIdFromFixture). Market created with
the agent's exact MLS template (`total_goals_over`, threshold 3,
`team: ""`) so the deterministic PDA matches and Matchkeeper adopts it
at `match_started` instead of creating a duplicate (loop.ts dedup):
- Market PDA: `6yCQDodZwwnLX9zXVYjjuUt4LSazBvcWZvzWrWvjSX3W`
- Oracle: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` (TxLINE devnet validator)
- closes_at: 2026-08-16T01:30:00Z (kickoff + 2h)
- Create tx: `4QXf5eRjw5M35kVgiQw86UrrehVqg1ps4h9UsqAigEwU6JcQD3jGtqFn8gLEEE3piQptxzW6UaPhM32ofjgmEN2s`
- Creator: `G33naaudTAyEWFnfLET51aWGNLry5BwUtZt6KwcniFoj` (0.01 SOL bond,
  claimable post-settle)
Betting opens ~2h before kickoff per the fixture gate; settlement runs
recorded after the Aug 15 settle.

**Keystone campaign surface live (2026-08-14).** `/keystone` is the
public campaign page for the Aug 15 match: dual-oracle comparison
(TxLINE Merkle path vs operator attestation, honest labeling),
phase-aware timeline (countdown → betting open → in play → receipts),
lead capture via Formspree (`NEXT_PUBLIC_FORMSPREE_ID` env — unset
falls back to an .ics calendar CTA), and a receipts section that fills
in on settlement. All facts (predicates, PDAs, timestamps) live in one
place: `lib/campaign/keystone.ts`; PDAs are derived, never hardcoded.
`KeystoneBanner` surfaces the match on the tape and the home hero.

**Same match, two oracles (deliberate, one weekend only).** The existing
attestation market (`tsdb:2406978`, PDA
`5Ji2788zjyk5jC2JxSWcCxDFA2vtqJMQqgDHjmiBLryL`, real 0.005 SOL YES) is
settled as planned via the Aug 10 attest runbook; a separate
TxLINE-oracle market on the same fixture settles from a TxODDS Merkle
proof. Two oracles, one match, two receipts — comparison artifact, not
a permanent dual plane.

## Aug 15–18 keystone settlement record (2026-08-18)

**The Aug 15 keystone (Orlando City vs FC Cincinnati) DID settle — earlier
"account gone / getAccountInfo null / nothing settled" reports were a stale
or mis-routed devnet RPC, not state loss.** Verified live on devnet
(2026-08-18):

- **TxLINE keystone market** `6yCQDodZwwnLX9zXVYjjuUt4LSazBvcWZvzWrWvjSX3W`
  (goals-over-3, fixture 17615188) — **`settled`, outcome `no`,
  settlesAt 2026-08-16T01:48:28Z, verifications 1**. Settle tx
  `4VH87BkRf…` shows `ResolveMarket` → **CPI into the TxLINE devnet
  validator `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` → success** —
  a genuine proof-gated settlement produced by the live keeper, the
  on-chain proof-is-the-authority moment the roadmap was waiting for.
  **Caveat:** yesPool/noPool = 0 → no real stakes landed, so the full M1/M2
  acceptance (two wallets join opposite sides, winner claims, vault drains
  to zero, loser's claim fails) is **still unmet**. Creation bond claimed
  (creator wallet) 2026-08-18 (`6aW2Y1uN…`).
- **Attestation market (same fixture)** (`5Ji2788zjyk5jC2JxSWcCxDFA2vtqJMQqgDHjmiBLryL`) —
  stayed **`open`**, 0 verifications, settlesAt null through match day; the
  Aug 15 attest runbook was never run. Since the attestation observation
  window (kickoff+105m+4h) has long expired, late settle was impossible;
  it was **voided** 2026-08-18 (`4TAu73Hs…`) and its creation bond claimed
  (`2RVGttkVq…`). The 0.005 YES stake is a stuck refund for position owner
  `MMFsiGn5eE…` (a key not in our possession) — left, negligible devnet
  amount.
- **Root cause for "keeper silent on match day": it wasn't silent — it was
  blocked by an expired TxLINE free subscription.** `subscribedAt` was
  2026-07-18; the free tier is 4 weeks, so it lapsed around 2026-08-15.
  `stoppage-agent` logs (Aug 16–17) show `Proof fetch/build failed: Stat
  validation failed: 401` retrying every 30m. The keystone settle that DID
  land (01:48 Aug 16) beat the credential lapse; everything afterwards
  couldn't fetch a proof.
- **4 keeper-created MLS markets from the Aug 15 kickoffs never settled**
  (SOU-WHI-17615192, FC-DAL-17615274, CIT-UNI-17615276, FIR-TIM-17615190):
  all `open`, zero stakes, stuck on the same 401. **Voided manually
  2026-08-18** (each creation bond refundable to the keeper wallet).
- **Subscription renewed 2026-08-18** (on-chain subscribe tx via
  `scripts/subscribe-txline.ts`) and the refreshed credentials were synced
  to the VPS `.env.agent`; `stoppage-agent` restarted with `--update-env`.
  Probe confirms API auth is healthy (no 401): MLS (comp 33) 62, EPL
  (comp 8) 290. `TXLINE_COMPETITIONS` set to `33,8` so EPL is covered from
  Aug 21.
- **Next: keystone EPL re-attempt (Aug 21, Arsenal v Coventry, EPL comp
  8)** — now unblocked. Recreate the keystone market for an EPL fixture
  under TxLINE, and drive a real **staked** settle so the M2 acceptance
  finally ticks.

**Housekeeping automated (2026-08-18, Phase 1).** `scripts/housekeep.ts`
is an idempotent cleanup/claim housekeeper (`npm run housekeep`):
settle-or-void stale markets (void only past closes_at + grace **and**
`--min-stale-hours`, default 8h, so it can't preempt the keeper's ~8h proof
window), claim creator bonds + held positions (refund on void, payout on
settled), and append `housekeep_void` / `bond_claimed` / `claim_refund`
facts to the match ledger. Defaults to reading candidate market IDs from
the ledger; pass `--market=<PDAs>` to target specific ones. `MatchEvent`
kind/source union extended with the housekeep events. Reuses the same SDK
+ TxLINE proof path as the keeper (`loop.settleMarket`). The **same logic now
also runs inside the live `stoppage-agent` loop (Phase 2)**: a 15-min
housekeeping pass gives up on pending settlements after their 8h retry
window (`SETTLE_RETRY_GIVE_UP_MS`) — final settle attempt, then void — and
sweeps creator-bond + position claims for every market the process made,
appending `bond_claimed` / `claim_refund` facts to the ledger. VPS cron
(Phase 1) still runs daily for markets the loop didn't touch. **Phase 3
(2026-08-18):** `scripts/txline-health.ts` (`npm run txline:health`) probes
TxLINE auth with a real authenticated call and fails loudly (exit 1 + alert
log + optional `ALERT_WEBHOOK_URL` post); VPS cron runs it every 6h.
`scripts/txline-renew.ts` (`npm run txline:renew`) computes the 4-week expiry
from the creds file and, when within `--days` (default 7) or the probe fails,
re-runs the subscribe flow; `--deploy` ships fresh creds to the VPS
`.env.agent` and restarts the agent. Renewal must run where the subscriber
wallet lives (the devnet deployer host). macOS LaunchAgent
`com.stoppage.txline-renew` runs it daily 09:10 with `--days=5 --deploy`.

**Frontend / product (2026-08-18).** `/keystone` was repointed from a
pre-match MLS-lead page to a two-chapter story reflecting reality:
**Chapter 1 — "the proof is the authority, it held"** (Aug 15 receipts: TxLINE
path settled NO by CPI, attested path voided + bond reclaimed) and
**Chapter 2 — the next keystone, the first staked settle** (Arsenal v Coventry,
EPL comp 8, Sat 2026-08-21 19:00 UTC) with a live countdown and "place your
stake on match day". An operational-trust strip surfaces the self-healing
keeper + 6h credential health guard — reliability presented as product.
`KeystoneBanner` (home + tape) now hangs on `NEXT_KEYSTONE`; page metadata
mirrors the new story. `MatchEventKind` housekeeper kinds surface in the
Matchkeeper Status rail. **Remaining to check off: M2 acceptance — the Aug 21
EPL market settled from a proof with real (devnet) stakes that drain.
**Attestation oracle → reference custom oracle (after TxLINE settle).**
Remains deployed and documented (docs/ATTESTATION-ORACLE.md,
docs/OPERATORS.md) as the worked "operators bring their own oracle"
example. No longer the primary path for MLS/EPL once one TxLINE MLS
market settles; homepage dual plane (`useAttestHero`) demotes then.

**Product-assessment response pass (2026-08-13).** Four UX/positioning
gaps from the internal assessment are addressed in the web app (no
program changes): (1) bet-slip error recovery — failures are classified
(`lib/markets/betErrors.ts`) into a structured card
(`components/SlipErrorCard.tsx`) with the one recovery action that
applies (forced wallet path for expired/revoked grants, refresh for
closed markets, honest "nothing was submitted" for wallet rejection);
rule-9 caps get enforcement copy, not a bypass button; the mobile dock
points at the card instead of blindly re-submitting. (2) Nav clarity —
"Live"/"Match" renamed to "Home"/"Match room" with tooltips on all six
routes; `/match` eyebrow matches. (3) Visual restraint — the full-bleed
MomentAlert fires only on real live signals: suppressed during replays
on `/match` (matching the existing preview suppression on home), and
dismissible via an explicit × on all three pages. (4) Proof as pre-bet
trust signal — the oracle registry (`lib/oracle.ts`) gained per-validator
`preBetLine`/`instrumentLine` copy; the bet slip shows the settlement
guarantee before the stake is placed, the home market face and the
oracle badge use validator-aware copy, the tape's `operator-attested`
chip shows even when live (with the atomicity-vs-epistemic-truth
tooltip), and the hero lede leads with the proof-gated guarantee.
Follow-ups not addressed (scoped out by choice): globals.css
decomposition, homepage hero simplification, session-fund sweep, CI.

**Telegraph Hackathon assessed → Icebox (2026-08-14).**
hackathon.telegraphprotocol.com — intelligence marketplace, not
settlement infrastructure. Track 1 (Miners) and Track 2 (eval scripts)
run Aug 17–31; Track 3 (apps on *their* miners) opens Aug 31–Sep 7.
H1 prize pool is $5k USD, not the $15k series figure. The only
transferable asset is `packages/txline` wrapped as a `SPORTS_SCORE` /
`GAME_RESULT` miner — same sports-data edge as Delphi, settlement
primitive unused. Track 3 would consume Telegraph API answers, not
Merkle proofs, and opens after the Aug 15 keystone. Window collides
with the first live MLS week and EPL start (Aug 21). Not entering.

Free subscriptions are still 28-day and lapse silently — re-run
`scripts/subscribe-txline.ts` every ~3.5 weeks. Paid tiers remain
mainnet-only (useless for the devnet CPI path). Mainnet still needs
legal review.

## Previous state (2026-08-10)

**Attestation oracle shipped: proof-gated sports settlement no longer
waits for TxLINE coverage.** New validator program
`attestation_validator` (devnet, deployed via `scripts/deploy.sh`,
first-deploy slot 482742825) verifies an operator-signed sports
observation via the ed25519 precompile in the same transaction as
settlement (precompile ix immediately precedes `resolve_market`; signer
pinned in the Config PDA; message bound byte-for-byte; window bounded).
Trust model documented honestly in docs/ATTESTATION-ORACLE.md: 1-of-1
operator attestation — the *atomicity* guarantee is unchanged, epistemic
truth is the operator's. Sept 23 TxLINE Friendlies remain the
third-party-verified milestone. 10 program tests + 4 SDK tests green;
existing 27 market/SDK tests unaffected.

**First attestation market live on devnet.** Orlando City vs FC
Cincinnati (MLS, TheSportsDB event 2406978, kickoff 2026-08-15 23:30
UTC): `total_goals_over:2`, oracle = attestation_validator, market PDA
`5Ji2788zjyk5jC2JxSWcCxDFA2vtqJMQqgDHjmiBLryL`, real second-wallet YES
position 0.005 SOL (join tx
`nZrn16nzaGxhS5N2jQqQo2YQVzS8dVd3FdrbvwMCZ5atjHtZAr3zvT5Gz36eRfD7hXeCoitScUKfiQsBE1AzpCr`).
**Match-day runbook:** after kickoff, rerun
`OTEL_EXPORTER_OTLP_ENDPOINT=http://144.202.117.160:4318 npx tsx apps/agent/src/index.ts attest --event=2406978 --line=2 --live-tx`
(OTL endpoint = VPS SigNoz, so the first attestation settle lands in
the `Matchkeeper Ops` dashboard) — the keeper resumes ("market exists"
branch), polls TheSportsDB until full-time, signs, submits the atomic
bundle. Then claim from the opponent wallet and verify the receipt
digest. This is the KeeperHub-
window real match, delivered via operator attestation instead of
TxLINE (see the amended note under "Things that don't scale").

**TxLINE access: probed live Aug 10 + docs reviewed.** Bundle contains
exactly competition 430 (Friendlies, 26 fixtures, earliest Sept 23);
`competitionId=1480` → 403 "not in your bundle" (we thought 1480 was
MLS — it is not). Docs (subscription-tiers + quickstart) confirm:
**paid tiers are mainnet-only** ($500+/28d) and useless for the
devnet CPI path even if purchased — TxLINE proofs must verify against
the same cluster's program. Free subscriptions are 28-day and **lapse
silently** — standing reminder: re-run `scripts/subscribe-txline.ts`
every ~3.5 weeks. **Amended 2026-08-13:** free/devnet bundle includes
MLS as competitionId **33** (see Current state 2026-08-13). The Aug 10
probe was a wrong-ID false negative, not a coverage gap.

**Deployer wallet thin; full redeploy deferred.** Deployer
(~/.config/solana/id.json) holds ~1.24 devnet SOL; the faucet rate-limit
hit mid-deploy. attestation_validator (the only changed program)
deployed; market/pyth/settlement bytecode is semantically unchanged and
was NOT redeployed. Next full `deploy:programs` run needs ~3 SOL —
retry the airdrop or top up first.

**Local environment note.** The Solana CLI had been wiped AGAIN
(~/.local/share/solana was absent). Reinstalled Agave 2.3.0 (pinned);
`cargo-build-sbf` re-downloaded platform-tools and self-healed the
rustup `solana` link. Also: `node_modules` was absent; `npm ci` restored
from the lockfile.

**Delphi Agent Arena (Gensyn) assessed → Icebox.** Wrong chain (EVM
testnet), wrong role (price taker on their markets, not settlement
infrastructure), and its Aug 10–24 window collides with the attestation
keystone's first live week. The one asset that would transfer
(packages/txline as a sports-data edge) only covers the sports slice.
Not entering.

## Previous state (2026-08-03)

**Hackathon result: did not place.** The TxODDS World Cup track
winners were announced July 29 (Touchline, Onyx, Proofline in
Prediction Markets & Settlement; TouchLine MM, LineWatch, TxAgent
in Trading Tools & Agents; Ticker, Mundial, Battlefield in Consumer).
Stoppage was not among them. The codebase and devnet deployment remain
intact and the settlement primitive is unchanged in value — the
post-hackathon identity decision below is now the live question.

**TxLINE data access confirmed live post-hackathon.** The winners'
announcement stated free data access continues into the season; verified
Aug 3 2026 against `txline-dev.txodds.com`: guest JWT renewal works
(no wallet needed, 30-day tokens), fixtures snapshot returns 16
International Friendlies (Sept–Nov 2026, the post-World-Cup coverage
window), scores/historical/validation/SSE endpoints all respond. The
historical-replay window is **rolling** (~2 weeks to ~6 hours ago): the
World Cup fixtures we demoed against (e.g. `18237038`, FRA-SPA
semi-final) now return empty from `/scores/historical` and 404 from
`/scores/stat-validation` — expected, not a regression. MLS is live at
~50% coverage; full Premier League begins Aug 21.

**Replay default no longer rots.** The agent's `replay` command dropped
its hardcoded `18237038` default (which silently fails now that the
fixture is out of window). With no fixtureId argument it auto-discovers
the most recent replayable fixture inside the rolling window — finished
fixtures in the current snapshot first, then known past fixtures in
`PAST_FIXTURES` (reverse-chronological), exiting with a clear message
if nothing is in window. See `docs/DEVELOPMENT.md` → "TxLINE data access
& the replay window". The settlement primitive, CPI path, and proof
encoding are unaffected — they consume whatever proof the API returns
for a fixture in window.

## Post-hackathon plan (2026-08-03)

The hackathon is over (did not place). The ongoing TxLINE data access
is the open opportunity — a season of real matches to prove the
primitive on, not just a one-off tournament. This section records the
plan so it isn't relitigated each session.

**Identity decision: run the betting-app path as proof-of-primitive,
hold on the infrastructure/operator push.** The data runway (Int'l
Friendlies → MLS 50% → full Premier League Aug 21) makes the demo path
viable for months. A working demo with real users is a stronger pitch
to operators than a devnet-only one. Let operator interest pull, don't
push cold.

**The keystone: one real market settled end-to-end on a live match.**
No real match has gone delegate → bet → settle → prove with real
(non-seeded) positions on a live fixture. The roadmap has said this
verbatim under "things that don't scale." The data access unblocks it.

Ordered work:

1. **Capture the first in-window fixture** (Sept 23, first covered
   Friendly: Azerbaijan vs Tajikistan, fixtureId 18272873). Run
   `scripts/capture-replayable-fixture.ts` the day it finishes to grab
   a known-good fixture + seq + statKey into `PAST_FIXTURES`, so the
   replay demo is never dead on a stale ID again.
2. **First real live run.** Run the agent in `live --live-tx` on a live
   covered match; get one market to settle from a real TxLINE proof with
   a real position. This is the single most useful artifact for any next
   step.
3. **Expand predicate coverage** (deferred from the hackathon sprint):
   `next_goal_within` and `card_shown` are scaffolded in the strategy
   but inactive. `next_goal_within` is a time-windowed predicate (settles
   mid-match when a goal is scored or the window expires), structurally
   different from the over/under predicates that settle at match end —
   it needs a settle-on-event path, not just settle-on-match-end. Build
   it against live matches over the season while the borsh/proof schlep
   is fresh. Each new predicate that settles from a verified proof
   extends the moat.
4. **Hold on operator onboarding docs** until an operator asks.
   OPERATORS.md is solid; the missing piece is a second party actually
   using it, not more documentation. Demand-pulled, not speculative
   (CLAUDE.md → "audit before adding").
5. **Hold on mainnet** (hard rule — legal review first). Devnet data
   access is sufficient to keep developing and demonstrating.

**Soonest covered match (as of Aug 3):** Sept 23, 2026 (Azerbaijan vs
Tajikistan, fixtureId 18272873). **Superseded 2026-08-13:** free/devnet
TxLINE includes MLS (competitionId 33) from Aug 15 and EPL fixtures
(competitionId 8) from Aug 21 — see Current state 2026-08-13. The Aug 3
belief that free tier was Friendlies-only used the wrong MLS competition
ID (1480).

## Previous state (2026-07-28)

**Pyth price oracle — the "oracle-agnostic" claim is now demonstrated live.**
A third program, `pyth_validator`
(`73co8qb1DPiQP9zphReVNdsUPsHJZ5EoD3RpfKWUoQQG`, deployed via
`scripts/deploy.sh`), verifies a guardian-signed Pyth PriceUpdateV2 account
(owner, discriminator, feed id, `[closes_at, closes_at + max_staleness]`
window, threshold) and returns a bool over CPI — the exact `SettlementOracle`
contract. The market program now accepts `price_above` (kind 4). The agent
gained a `price` mode (`npx tsx apps/agent/src/index.ts price --live-tx
--interval=N`) that creates interval SOL/USD markets from free Hermes data
and settles them through the identical resolve → settle_from_proof →
attest bundle. End-to-end on devnet: market
`FEG8wYtZkGJUVTbWEKoJkpQ5XFNSQTMA7bz9FmGFFwDb` (sol_above:74 @ 19:45 UTC)
joined 0.005 YES
(`3C5MFYM3pJCyQb5RbpLnBQatvFiNY6vymL7gCMV2g9uVjvUF6727REEbYWsbKdZ7UjpafRkcpX9DfoozWDvRZu3a`),
settled YES via validator CPI
(`4TQfzkhS6ydo9pLd1iMMocjxMBRg49dpQWCPgx5hCEZsSuQUYYAbH2xv4b4JfjxCYbEEG2v6x5KuQT98LLMMa5na`,
logs show `validate_price price=7411500000 threshold=7400000000 -> true`),
claimed + bond refunded
(`5N9pRn55rw2WZaTHR3XkRPcdhHEsh98FQ7Fsw5pHXKwJwW6LbvGHSjroAWdXrKBWs2v2DHmiShmp3XGhTsL44b6S`).
Receipt `merkle_root` carries a digest of the verified observation (no
Merkle root exists for price oracles — digest semantics documented in
OPERATORS.md). Web UI: price markets are bettable without fixtures (they
resolve against a price window, not a match), and render
`Price above $X on SOL/USD`. PM2 config adds `stoppage-price` for the VPS.
npm `overrides` pins jito-ts's bundled web3.js to 1.98.4 (its old chain
breaks ESM module loading on Node 24); the keeper loads the receiver CJS
entry explicitly (`createRequire`) because pyth's ESM entry imports a
jito-ts deep path without an extension.

**Proof board root cause fixed.** The degraded board (2 players / 1
market) was a `dataSize` filter mismatch: the oracle-agnostic pivot added
the 32-byte `oracle` field (139 → 171 bytes), and the 14 legacy pre-pivot
markets were silently dropped from scans. The board now scans both
layouts (`upgradeLegacyMarketData` normalizes legacy buffers; parseMarket
stays single), retries with backoff, falls back Shyft → Helius → public
RPC, variants return `degraded: true` instead of partial data. Verified
locally against devnet: 15 markets / 5 players / 6 verified.

**Toolchain reinstall.** The Solana CLI install dir had been wiped;
Agave CLI 2.3.0 was reinstalled (matches DEVELOPMENT.md pin) and the
rustup `solana` toolchain link was repointed at platform-tools v1.48
(rustc 1.84, consistent with the Cargo.lock pins).

## Previous state (2026-07-24)

**Strategic pivot: settlement primitive for operators.** The product is no
longer positioned as a betting app; it's a proof-gated settlement
infrastructure where operators bring their markets and their own oracles.
World Cup data access ended July 19; the creative monopoly is the first
settlement primitive where fund release is cryptographically gated on an
on-chain proof verification. The /operators page, OPERATORS.md, and
OPERATOR_PITCH.md now lead with this positioning.

- **Oracle-agnostic settlement deployed on devnet.** Settlement program
  accepts any validator program via remaining_accounts[0], with anchor
  accounts in remaining_accounts[1..]. No hardcoded TxLINE program IDs or
  account owners on the contract. Market program stores `oracle: Pubkey`
  on the Market account at creation and cross-checks the resolution
  receipt's `validator_program` against it in `settle_from_proof` — a
  market cannot be settled by a foreign proof. Resolution struct now carries
  validator_program; MarketResolved event carries it too. Added
  `ResolutionOracleMismatch` error.
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
- **Anchor build green.** `npm run anchor:build` passes locally; the
  Solana Rust toolchain is installed and working.
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
  (17 passing, 1 pending). M3 on-chain CPI verified against TxLINE
  fixture 17952170 pre-pivot (devnet tx
  `En879uAi8pGPoUDs6tAhvG6hFLAqMg4XHBXHQrYLpUAoGwkqxFAi3ZHUY6gb8mDN8VNMXgQ5TJYwNeU2C2x8hm1`).
- **TxLINE free-tier subscription** active on devnet; World Cup access
  ended July 19. Mainnet service levels 1 (60s delay) and 12 (real-time)
  available for World Cup & International Friendlies only.

**Remaining before operator-ready:**

1. **Operator pilot.** Find one prediction-market protocol or fantasy
   platform to integrate with a custom validator. The milestone is one real
   operator settling one real market through their own validator, not
   fifty seeded devnet markets.
2. **Mainnet deployment.** Requires legal review (see README compliance
   note) before any funds move to mainnet.
3. **Operator onboarding expansion.** Flesh out `docs/OPERATORS.md` with a
   full integration guide: validator requirements, account layout,
   testing checklist, example validator program.
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
  suite passes against a local validator (17 passing, 1 pending).** The
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
- [x] Program tests covering: payout math, double-claim, claim-before-
      settle, join-after-close, session-key join with expired/revoked
      grant, cumulative-spend-cap breach, side-mismatch guard — written
      in `tests/market.ts` (17 passing, 1 pending: the void refund path,
      needs a clock-warp harness).
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

## M7 — Agent observability (wired; landing verified 2026-08-11)

SigNoz / OpenTelemetry for the Matchkeeper keeper. See
[OBSERVABILITY.md](./OBSERVABILITY.md).

2026-08-11: first confirmed end-to-end landing (OTLP probe span queried
in ClickHouse), then real agent spans (`attest.ensure_config`,
`attest.event_fetch`, service `stoppage-agent`) after two real bugs
were found and fixed: (1) the attestation keeper had NO span
instrumentation — added `withSpan` around config/event/create/settle
plus `recordAction` counters; (2) one-shot modes (attest, replay) exited
inside the BatchSpanProcessor's 5s window before flushing — added
`shutdownTelemetry()`, called at the end of attest mode. Empty tables
since Aug 3 were absence of traffic (an idle live agent emits nothing —
BatchSpanProcessor has no ended spans and the metric reader skips empty
collections), not a pipeline failure; WC-era spans were dropped by the
default 15-day retention TTL. Open hygiene items: ingester publicly
reachable on 0.0.0.0:4317-4318 (restrict to localhost + ssh tunnel);
raise retention if demo history matters.

- [x] OTel SDK + structured JSON logger in `apps/agent/src/telemetry/`
- [x] Spans around `handleEvent`, `executeAction`, proof fetch, tx submit
- [x] Counters: actions, txline events, proof fetch outcomes
- [x] SigNoz on VPS (Foundry, UI `:9090`, OTLP `:4318`) — `./scripts/install-signoz-vps.sh`
- [x] VPS PM2 env wired (`OTEL_EXPORTER_OTLP_ENDPOINT` in `.env.agent`)
- [x] SigNoz dashboards (match ops, settlement reliability)
- [x] Alerts: settlement failure, SSE gap, proof timeout

## Icebox (explicitly not now)

Recorded so they stop tempting us mid-sprint (see CLAUDE.md → Scope
discipline): Delphi Agent Arena (Gensyn trading competition, assessed
2026-08-10 — wrong chain, wrong role, window collides with the
attestation keystone; revisit only if a future edition is
settlement-infrastructure-shaped), Telegraph Hackathon (intelligence
marketplace, assessed 2026-08-14 — wrong role: miner/eval wrapper or
consumer of their sports APIs, not settlement infrastructure; Track 1/2
Aug 17–31 collides with the MLS keystone and EPL start; Track 3 opens
after the keystone and requires Telegraph miners not TxLINE proofs;
revisit only if a later season is settlement-infrastructure-shaped),
SPL-token stakes, AMM/LMSR pricing
(vault-ratio odds are
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
