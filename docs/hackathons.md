# Hackathons

Fit notes and build plans for hackathon tracks Stoppage could enter.
Active prep lives in [ROADMAP.md](./ROADMAP.md); observability setup in
[OBSERVABILITY.md](./OBSERVABILITY.md).

---

## 1. KeeperHub — The Last Mile Hackathon (Jul–Aug 2026)

### Overview

**KeeperHub** is the execution and reliability layer for AI agents operating onchain. The hackathon is about building agents that actually execute onchain — not just decide.

**Timeline (UTC+2):**

| Date | Event |
|---|---|
| Jul 27, 12:00 | Hackathon opens |
| Jul 27 – Aug 13 | Build phase (~2.5 weeks, weekly office hours) |
| Aug 13, 12:00 | Submission deadline |
| Aug 13–20 | Judging |
| Aug 20 | Winners announced |

**Prizes:** $5,000 in cash (1st: $2,000, 2nd: $1,200, 3rd: $800) + $1,000 in bounties (Best Onboarding UX Improvement).

### Requirement

Every project **must** use KeeperHub as its onchain execution layer. The KeeperHub stack includes:

- **MCP server / CLI** — agent discovers and calls KeeperHub's execution capabilities natively
- **x402 / MPP** — pay-per-execution over HTTP, settled onchain; or autonomous payments via Tempo and Stripe
- **Smart Gas Estimation** — adaptive gas pricing with exponential backoff
- **Private routing** — MEV protection via non-public submission paths
- **Audit trail** — every action logged: trigger, simulation, submitted tx, gas used, outcome, timestamp
- **Gas sponsorship** — available on mainnet Ethereum

### Judging Criteria

| Criterion | Weight |
|---|---|
| Does it execute onchain via KeeperHub? (working transactions, not mockups) | Heavy |
| Use of KeeperHub surfaces (MCP, CLI, x402, MPP, workflow builder, audit trail) | Heavy |
| Reliability and observability (retries, gas handling, audit trail) | Medium |
| Originality and real-world usefulness | Medium |
| Integration quality and developer experience | Medium |

### Stoppage's Fit

Stoppage is a Solana-native in-play sports micro-market protocol. KeeperHub is an EVM execution layer — so integration requires bridging or adapting execution paths rather than a drop-in replacement.

| Criterion | Stoppage's Position |
|---|---|
| **Executes onchain via KeeperHub** | Not yet — currently uses Solana `@solana/web3.js` for all tx. KeeperHub would handle **x402 payment flows** (market entry fees, premium data access) or **cross-chain settlement attestation** |
| **KeeperHub surfaces used** | Potential: x402 for paid market entry, MCP for agent orchestration, audit trail for Matchkeeper's pricing attestations |
| **Reliability** | Agent already has retry logic, compute budget management (1.4M CU), and devnet rate-limit handling. KeeperHub's smart gas + private routing would improve mainnet readiness |
| **Real-world usefulness** | In-play sports micro-markets are a massive market. Session-key delegated betting + proof-gated TxLINE settlement are genuine differentiators |
| **Integration quality** | Clean SDK → agent → web modularity. KeeperHub would slot naturally into `apps/agent/src/loop.ts` as an execution rail alongside direct Solana tx |

**Best angle for this hackathon:** Stoppage's Matchkeeper agent watches TxLINE events and creates/settles markets. Adding KeeperHub gives it a **cross-chain payment and execution rail**: market entry fees paid via x402, settlement attestations logged through KeeperHub's audit trail, and the agent's decision history visible on x402scan.com. The agent thinks (TxLINE → strategy), KeeperHub acts (payment + execution + audit).

### Proposed Integration Points

| Integration | What It Does | KeeperHub Surface |
|---|---|---|
| **x402 market entry** | Users pay market entry fees via x402 instead of SOL devnet tx | x402 / MPP |
| **Matchkeeper audit trail** | Every agent decision (create, settle, void, quote) logged via KeeperHub | Audit trail |
| **Cross-chain settlement proof** | Settlement outcomes attested on EVM via KeeperHub as a public record | MCP / contract-call |
| **Gas-sponsored claims** | Winners claim payouts with KeeperHub gas sponsorship (no SOL needed) | Gas sponsorship |

### Build Plan

| Step | Work | Effort |
|---|---|---|
| 1 | Add `@keeperhub/mcp` dependency to `apps/agent/package.json` | 15 min |
| 2 | Create `apps/agent/src/keeperhub.ts` — KeeperHub client wrapper (x402 payment, audit trail, contract-call) | 2–3 hrs |
| 3 | Wire x402 payment flow into market entry: user pays entry fee via x402, agent monitors onchain confirmation, then creates the market position | 4–6 hrs |
| 4 | Wire audit trail: on every `onAction` callback in `loop.ts`, post the action to KeeperHub audit trail | 2–3 hrs |
| 5 | Wire settlement attestation: after `settle_from_proof` succeeds on Solana, submit the settlement receipt to KeeperHub as an EVM attestation | 3–4 hrs |
| 6 | Demo video + transaction links | 2 hrs |

**Total estimated effort: ~15 hours** — feasible within the 2.5-week build window.

### Submission Requirements

1. A link to source code on GitHub ✅ (https://github.com/sneldao/stoppage)
2. A short demo video showing the agent executing onchain through KeeperHub
3. A link to a transaction executed via KeeperHub

### Recommended Prep

- [ ] Add KeeperHub MCP server integration to the autonomous agent
- [ ] Produce a demo video showing x402 payment flow + audit trail
- [ ] Capture and link a real KeeperHub-executed transaction
- [ ] Optionally: merge a PR improving KeeperHub's onboarding UX (separate $1,000 bounty)

---

## 2. SigNoz Observability Hackathon (2026)

### Overview

SigNoz is an open-source observability platform built on OpenTelemetry. This hackathon requires deep integration with SigNoz — traces, metrics, logs, dashboards, and alerts.

**Tracks:** AI & Agent Observability, Signals & Dashboards, Build Your Own.

**Required tech:** Must use or integrate SigNoz. Install via Foundry. Repo must include `casting.yaml` and `casting.yaml.lock`.

**Judging:** The more deeply you lean on SigNoz and OpenTelemetry — traces, metrics, logs, dashboards, alerts — the stronger your submission.

### Stoppage's Fit

| Criterion | Stoppage's Position |
|---|---|
| **Agent complexity** | Event-driven loop consuming TxLINE SSE → strategy engine → on-chain create/settle/void/quote. Multi-step pipeline with real-time match events, deterministic proof settlement, and verifiable quant pricing |
| **Existing observability** | Console-only logging, `MatchEvent` ledger facts. Major observability gap — SigNoz would add enormous value here |
| **OpenTelemetry surface** | Every match event produces a trace: `txline_event_received` → `strategy_evaluate` → `market_action` (create/settle/void/quote) → `proof_fetch` → `cpi_validate_stat` → `tx_confirmed`. Plus the quant pricing pipeline |
| **Dashboard value** | Live match activity feed, market creation/settlement rates, proof validation success rate, vault pool sizes, Matchkeeper pricing accuracy vs settled outcomes, Helius subscription health |
| **Alert potential** | Settlement failures, proof validation errors, TxLINE SSE disconnects, rate-limit hits, market expiry without settlement, pricing divergence |

**Best track:** **Signals & Dashboards** — real-time match signals (goals, corners, cards) mapped to market activity is a perfect real-time dashboard. Or **AI & Agent Observability** for the Matchkeeper autonomous agent.

### Proposed Integration

| SigNoz Feature | Stoppage Integration |
|---|---|
| **Traces** | OpenTelemetry spans around every agent action: `txline_event` → `strategy_decision` → `proof_preparation` → `tx_submission` → `confirmation`. Trace attributes for matchId, marketPda, predicate kind, outcome |
| **Metrics** | Markets created/settled/voided per match, proof validation success rate, on-chain CPI execution time (1.4M CU budget), pricing attestation latency, session-key delegation count |
| **Logs** | Structured JSON logging replacing `console.log` — every agent action, error, and retry with span context |
| **Dashboards** | Live match operations dashboard: event stream, market lifecycle, settlement accuracy leaderboard, Matchkeeper pricing verification rate, vault health |
| **Alerts** | Alert on: settlement tx failure, proof fetch timeout, TxLINE SSE disconnect, consecutive void_market triggers |
| **Foundry** | `casting.yaml` declares SigNoz + OTel Collector + stoppage agent + web app |

### Build Plan

| Step | Work | Effort |
|---|---|---|
| 1 | Install SigNoz via Foundry, create `casting.yaml` | 1 hr |
| 2 | Add OTel JS instrumentation to `apps/agent/src/loop.ts` — wrap `executeAction`, `handleEvent` with spans | 3–4 hrs |
| 3 | Replace `console.log` with structured JSON logger with trace context | 1–2 hrs |
| 4 | Create dashboards for match operations, settlement reliability, agent activity | 2–3 hrs |
| 5 | Set up alerts for settlement failures, TxLINE disconnects, rate-limit events | 1–2 hrs |
| 6 | Demo video showing trace waterfall (event → strategy → settlement → confirmation) | 1 hr |

**Total: ~12 hours.**

---

## 3. AnsemHack — The Clawrena (Aug 19 – Oct 1, 2026)

### Overview

**AnsemHack** is ClawPump's build-in-public arena on Solana: build an
agent, put a token on it, ship in front of the judges on stream.
(clawpump.tech/ansemhack)

**Prize pool:** $350K — $250K of $ANSEM (0.1% of supply, 3-month vest
behind a 1-month cliff) + $65K sponsor cash + $10K compute.

**Timeline (UTC):**

| Date | Event |
|---|---|
| Aug 19 | Registration opens; Helius RPC + Alchemy credits unlock |
| Aug–Sept | Build in public; weekly livestream slots (MCG, EasyA, Ansem) |
| **Sept 20, 23:59** | **Register AND tokenize deadline — both** |
| Sept 21–30 | Judging; finalists join the stream |
| Oct 1 | Winners announced |

**Target track: ClawPump × pump.fun** (50% of $ANSEM ≈ $125K + $40K
cash, judged by ClawPump and pump.fun together). Every tokenized team
is automatically in the running for Overall Winner (25% of $ANSEM) —
no separate application.

### Eligibility — registration done 2026-09-20; remainder by Oct 1

Registered as `stoppage` / `@sportwarren` / `$STOPPAGE` (ClawPump ×
pump.fun + Inference Markets). The confirmation screen overrides the
earlier read: the remaining steps are due **by 1 Oct 2026**, not Sept
20 — but earlier is strictly better, since judging (Sept 21–30) scores
what ships during the window and token activity needs time to exist.

1. **Post the entry on X and follow @clawpumptech** — the provided
   announcement text (tags them already) plus their image (X can't
   attach it; download/copy it into the post manually). No
   confirmation email; the post is the receipt. Attach it at the entry
   page (`/ansemhack/entry`).
2. **Tokenize on ClawPump**, verified against `@sportwarren` — attaches
   automatically. Same caveats as ever: entry ticket, no promised
   utility. Sooner beats Oct 1: a token born Sept 21 has nine judging
   days of history; one born Sept 30 has none.

Also manual, at registration: claim the Helius RPC credits and apply
for the Alchemy credits (up to $25K).

### Track fit

The ClawPump × pump.fun award is a **builder and trader** award. Its
own wording splits two ways: "turn an agent into a company that does
real work" (builder) or "ship an agent that trades a live market and
survives it, across spot, perps, market making and prediction markets"
(trader).

Stoppage pitches under the **builder** half: Matchkeeper *operates*
markets — it creates, settles and voids them autonomously from TxLINE
events — it does not trade them. Prediction markets is the thematic
hook, but be precise: this is a market operator, not a trading agent.
The track's scoring line ("we score what you added, not what you
wrapped") favors the proof-gated settlement primitive — net-new
tooling, not a wrapper on existing infra.

### Caveats (recorded 2026-09-19; decision logged in ROADMAP.md)

- **The token is an entry ticket, not protocol equity.** Scope it
  publicly as: devnet settlement infrastructure; this token is our
  Clawrena entry; no promised utility. The moment the token promises
  in-protocol utility (fee share, governance, staking) it merges with
  protocol economics and inherits the legal surface the
  infrastructure path deliberately avoids (devnet, no real-money
  betting). Don't do that.
- **Devnet honesty.** "Onchain volume" to date is devnet, largely
  self-staged (0.01 SOL/side via `scripts/stage-keystone.ts`). The
  page states judges "see the onchain data." Pitch the verifiable
  receipts — settle txs, CPI into the TxLINE devnet validator, vault
  drained to rent-exempt — never implied mainnet traction. "Live on
  Solana" to a pump.fun-adjacent audience implies mainnet; the honest
  line is "working proof-gated settlement on devnet, receipts
  on-chain," which lands better with this judge panel anyway
  (Solana Foundation, Helius, pump.fun, Colosseum).
- **Attention is the real cost.** Judging (Sept 21–30) scores what
  ships during the window. A token launched and ghosted reads worse
  than no token. Minimum viable stewardship: the X entry post, a
  couple of build-in-public updates during judging week, and a stream
  slot if offered.
- **Holder expectations exist regardless of disclaimers.** A token
  launched and abandoned carries a small reputational debt — the
  standard shape of hackathon entries, but real. Budget the
  stewardship above, not zero.
- **Does not void the infra path.** The token is a
  distribution/marketing layer over unchanged code, SDK and operator
  pitch. The entry exists because infra traction has been
  distribution-limited: the Clawrena's streams and judge panel are a
  better operator funnel than cold OPERATORS.md outreach — ROADMAP
  already says "one operator pilot pulls the B2B thread," and this is
  where operators are watching.

### What wins (per the page)

- Builders: "novel use of existing tech, or net-new tooling on the
  Hermes harness."
- Traders: "realised performance, risk control, onchain volume on
  Solana."

Stoppage's case: proof-gated settlement primitive (resolve_market +
settle_from_proof atomic via TxLINE validator CPI) plus the autonomous
agent already running it on live fixtures — settled, claimed, vault
drained, receipts on-chain (see ROADMAP.md Aug 21/24 keystone record).

### Shipped Sept 20, inside the judging window (scores Sept 21–30)

All web-layer, all demoable on stream, none touching settlement:

- **Jev live reads in the match room** (`typesafe-ai/jev` via Vercel AI
  Gateway, free promo): four parallel questions per feed tick beside the
  proof path. Novel use of launch-week tech, honestly labeled fallback.
- **Shareable proof cards** (canvas PNG + X intent from the settlement
  climax and the proof panel, co-branded Stoppage · TxLINE · Jev via
  Vercel) — the "see the onchain data" artifact as a viral unit.
- **Matchday surfaces**: void-state room became next-kickoff room with
  live countdowns, today's slate, gate-open reminders (localStorage +
  Browser Notification), betting-open chip, streak nudges, referral
  visibility, you-vs-quant tally.
- **Reliability hardening**: score-route caching, fixtures failure
  backoff with 401/429 forwarding, hidden-tab read guards — the keeper
  story for a triple-header afternoon.
- **Distribution plumbing**: OG image cache-busted and verified for
  link previews (the X entry post needs its card), demo clips cut.

Net: the entry now shows a living product (reads move, countdowns tick,
settles mint cards) instead of a protocol diagram — strictly better for
stream judges and the builder-half scoring line.

### Sponsor stack (assessed 2026-09-19)

The sponsors are the scoring surface beyond the track itself — each
one already touches the stack or costs nothing to claim.

| Sponsor | What they give | Stoppage fit | Action |
|---|---|---|---|
| **Helius** | Free RPC credits for registered teams | Already load-bearing — `NEXT_PUBLIC_HELIUS_RPC_URL` feeds every API route and the live monitor | Claim at registration; zero code work |
| **UsePod** | Inference Markets track: 15% of $ANSEM + $10K compute | **Integrated (2026-09-19).** Advisory layer only — see verdict below. `apps/agent/src/usepodAdvisor.ts` pays per call via x402 (SOL on mainnet, on-chain verified) at `match_started`; the model narrows/adjusts the bounded template set through the `templates` seam in `decideActions`. Non-gating: failures fall back to `DEFAULT_TEMPLATES` | Built; enable via `USEPOD_ADVISORY=1` (needs mainnet SOL on the agent keypair) |
| **Alchemy** | Up to $25K credits (application + approval) | **Integrated (2026-09-19) as the RPC fallback.** `apps/web/lib/rpc.ts` resolves Helius → Alchemy → public devnet for every API route, the calibration report, the board scan, and the live monitor | Apply for credits; set `NEXT_PUBLIC_ALCHEMY_RPC_URL` |
| **ClawPump** | Launchpad + trading fees from day one | Required — the entry itself | Tokenize (eligibility step 3) |
| **Streamflow** | Vesting rails for the $ANSEM award | Nothing to build — they vest the winnings | No action unless we win |
| **EasyA** | Kickstart track ($25K cash) | Alternative launchpad — "pick it instead of the ClawPump tracks, not alongside" | Skip — ClawPump is the better thematic fit |
| **Colosseum / MCG / Superteam / BlockZero** | Founder support, media spotlights, post-hackathon | Distribution, not integration | Take the stream slot; follow up after Oct 1 |

**UsePod verdict (researched 2026-09-19, docs.usepod.ai).** UsePod is a
two-sided **LLM inference marketplace**: a drop-in OpenAI-/Anthropic-
compatible proxy backed by independent GPU operators and BYO-key
relays, billed in USDC on Solana. Two payment rails: prepaid token
balance, or **x402** — accountless pay-per-request in USDC or SOL,
verified on-chain (quote → pay → settle with `PAYMENT-SIGNATURE`).
Text/chat endpoints only.

What that rules out: the original idea of hosting `@stoppage/quant`'s
Monte Carlo on UsePod. It serves LLM calls, not arbitrary binaries —
there is no "same model code, same seed" determinism story, and the
pricing receipts must stay on the local deterministic model. This is
the same boundary as the TypeSafe icebox line: **probabilistic
inference never gates a market action or the settle path.**

What remains viable (advisory, non-gating — same guardrail as
TypeSafe, but with track credit):

- **Market selection.** At `match_started`, ask a model which proven
  templates to run for this fixture. The `templates` param on
  `decideActions` (`apps/agent/src/strategy.ts`) is the seam: an
  upstream advisory call returns a `MatchTemplates` subset — the model
  can only *narrow* the proven set, never invent predicates or move
  settlement. Bounded failure mode, keeps on-chain correctness
  untouched.
- **Per-market preview copy.** Model-written context per created
  market for the UI; cosmetic but genuinely per-call inference.
- **Ops triage.** Model summarises stuck markets / keeper anomalies
  for the operator.

Payment story that fits the theme: the agent pays for each advisory
call via x402 in SOL on Solana — "the market operator buys its own
judgment calls on-chain, per decision, with receipts."

**Integrated 2026-09-19:** `apps/agent/src/usepodAdvisor.ts` +
`loop.ts` wiring. Env: `USEPOD_ADVISORY=1` (default off),
`USEPOD_MODEL`, `USEPOD_PAYMENT_RPC` (mainnet), `USEPOD_MAX_PAYMENT_
LAMPORTS` (safety cap, default 100_000). The advisory note lands in the
ledger as a `decision_logged` event with the x402 payment signature.
**Caveat for ops:** x402 settles on Solana mainnet — the agent keypair
needs a small mainnet SOL balance even though everything else is
devnet.

Honest read: real but thin. The track rewards "how deep the inference
goes and what it unlocks" — an advisory layer is genuinely in the loop
but not load-bearing in the way a resell/provider play would be. It's
in because it was cheap and on-theme, not because it wins the track on
its own.

---

*Archived: Aug 2026*
