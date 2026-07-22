# Observability

OpenTelemetry instrumentation for the Matchkeeper agent (`apps/agent`).
Export target: [SigNoz](https://signoz.io/) (self-hosted or cloud).

## Why

The keeper runs 24/7 on a VPS with `--live-tx`. Today, failures (settlement
tx errors, TxLINE SSE drops, proof fetch timeouts) only surface in PM2 logs.
Traces + metrics make the event → strategy → proof → tx pipeline legible and
alertable.

## Local SigNoz

```bash
git clone -b main https://github.com/SigNoz/signoz.git /tmp/signoz
cd /tmp/signoz/deploy
docker compose up -d
```

UI: http://localhost:8080 (first visit prompts admin setup).

On the VPS, coolify-proxy already uses `:8080`; our install maps SigNoz UI to **`:9090`**.

OTLP HTTP receiver: `http://localhost:4318`.

## Agent configuration

Telemetry is **opt-in** — without `OTEL_EXPORTER_OTLP_ENDPOINT`, the agent
still emits structured JSON logs to stdout (trace IDs appear once OTel is on).

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=stoppage-agent

npx tsx apps/agent/src/index.ts replay 18237038
```

On the VPS, add the same vars to the PM2 env block in
`deploy/ecosystem.agent.config.cjs` (point at your SigNoz host).

```bash
# In .env.agent on the VPS (see deploy/agent-config.example):
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_SERVICE_NAME=stoppage-agent

# One-time SigNoz install on the VPS (requires sudo):
./scripts/install-signoz-vps.sh

# Redeploy agent with updated env:
./scripts/agent-deploy.sh --logs
```

View the SigNoz UI via SSH tunnel: `ssh -L 9090:127.0.0.1:9090 nuncio-vultr`
→ http://localhost:9090

### Verify without Docker

No local Docker? Confirm export with a mock OTLP receiver:

```bash
npm run verify:otel
```

### Dashboard and alerts

Provision the **Matchkeeper Ops** dashboard and alert rules (trace + metric based):

```bash
cp deploy/signoz.env.example .env.signoz   # fill admin email/password/orgId
npm run provision:signoz
```

On the VPS (after `install-signoz-vps.sh` and first-time admin setup):

```bash
cp deploy/signoz.env.example .env.signoz
npm run provision:signoz
```

Dashboard panels: TxLINE events, agent actions, proof fetches, tx submits,
failed actions, SSE errors. Alerts fire on action/proof failures, SSE error
rate, and missing TxLINE events for 5 minutes.

View UI: `ssh -L 9090:127.0.0.1:9090 nuncio-vultr` → http://localhost:9090

Notification channel `stoppage-ops` posts to the agent `/health` webhook as a
placeholder — swap for Slack/email in SigNoz Settings → Notification channels.

## Trace model

Each TxLINE event opens a root span; actions nest beneath it:

```
txline_event
├── strategy_evaluate
├── agent.execute_action (create_market | settle_market | void_market | quote_market)
│   ├── proof_fetch          (settle only)
│   └── tx_submit            (live tx only)
└── tx_confirmed
```

Span attributes include `match.id`, `fixture.id`, `market.pda`, `action.type`,
`predicate.kind`, and `tx.signature` where available.

## Metrics

| Metric | Labels | Meaning |
|---|---|---|
| `agent.actions` | `action.type`, `success` | create / settle / void / quote outcomes |
| `agent.txline.events` | `event.type` | inbound normalized events |
| `agent.proof.fetch` | `success` | TxLINE validation proof retrieval |

## Dashboards and alerts (next)

Suggested panels (SigNoz hackathon track: Signals & Dashboards):

- Match event rate vs market create/settle rate
- Proof fetch success ratio
- Settlement tx failure count (alert threshold > 0 in 5m)
- TxLINE SSE disconnect (agent process restart or gap in `txline_event` spans)

## Code layout

```
apps/agent/src/telemetry/
  init.ts     OTel SDK (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  logger.ts   JSON logs with trace/span correlation
  spans.ts    withSpan helper
  metrics.ts  counters
```

Instrumented paths: `loop.ts` (`handleEvent`, `executeAction`, proof fetch,
tx submit). Web app instrumentation is a follow-up.
