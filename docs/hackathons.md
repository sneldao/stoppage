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

*Archived: Aug 2026*
