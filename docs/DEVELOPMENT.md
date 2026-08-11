# Development

## Prerequisites

- Node >= 18, npm (workspaces)
- Rust via **rustup** (the Homebrew rust formula will not work — see below)
- Solana CLI 2.3+ / Anchor CLI 0.32.1 (pinned in Anchor.toml; `npm run check:ids` verifies)

## Commands

```bash
npm install              # workspace install (apps/web + apps/agent + packages/*)
npm run dev              # Next.js dev server
npm run build            # production web build
npm run typecheck        # tsc over apps/web (includes the sdk via paths)
npm run check:ids        # assert all program-ID sources agree
npm run sync:ids         # rewrite all ID references from keys/*.json
npm run anchor:build     # build both programs
npm run anchor:test      # build + run program tests against a local validator
npm run test:programs    # run program tests without rebuilding (faster iteration)
npm run deploy:programs  # the ONLY supported deploy path (scripts/deploy.sh)
```

### Git hooks

```bash
./scripts/install-hooks.sh   # install pre-commit hook (secret detection + check:ids)
```

The pre-commit hook scans staged files for secrets (JWTs, API keys, PEM
keys), blocks forbidden files (`.env`, `.txline-credentials.json`), and
runs `check:ids` when program-related files are touched. Bypass with
`git commit --no-verify` only for false positives.

### Local environment

`apps/web/.env.local` is the Next.js local runtime file. It is gitignored
and should stay mode `600` because it may contain `SHYFT_API_KEY`,
`TXLINE_JWT`, and `TXLINE_API_TOKEN`. The repo-root `.env.local` is also
gitignored and can be used as a local backup for command-line scripts or
manual recovery if server secrets are wiped. Never stage either file.

`SHYFT_API_KEY` is server-side only; do not expose it as `NEXT_PUBLIC_*`.
The public board route tries Shyft first and falls back to the public
devnet RPC when the free Shyft plan rejects indexed `getProgramAccounts`.

### Agent commands

```bash
# Dry-run replay (default — no on-chain txs, safe for testing).
# With no fixtureId, the agent auto-discovers the most recent
# replayable fixture inside TxLINE's rolling historical window:
npx tsx apps/agent/src/index.ts replay
# Or pass an explicit fixtureId:
npx tsx apps/agent/src/index.ts replay <fixtureId>

# Live transactions on devnet (requires funded wallet + Helius RPC):
npx tsx apps/agent/src/index.ts live --live-tx

# Price markets (Pyth oracle — no TxLINE needed, free Hermes data):
npx tsx apps/agent/src/index.ts price --live-tx --interval=1800

# Attestation markets (operator-signed, ed25519 — TheSportsDB source,
# covers MLS/EPL which TxLINE's free bundle doesn't; see
# docs/ATTESTATION-ORACLE.md):
npx tsx apps/agent/src/index.ts attest --event=<theSportsDbEventId> --line=2 --live-tx

# TxLINE subscription (one-time, saves credentials to .txline-credentials.json):
npx tsx scripts/subscribe-txline.ts

# Capture a replayable fixture (run after a covered match finishes):
# finds a finished fixture in the rolling replay window, probes its
# historical data + stat-validation path, and prints a ready-to-paste
# PAST_FIXTURES entry for apps/agent/src/index.ts.
npx tsx scripts/capture-replayable-fixture.ts
npx tsx scripts/capture-replayable-fixture.ts --fixture <fixtureId>
```

### TxLINE data access & the replay window

TxLINE's free-tier data access **continues past the World Cup hackathon
into the season** (confirmed live, Aug 2026). The docs state: free access
to World Cup + International Friendlies data via complimentary tiers,
real-time and 60-second-delayed options. MLS is live at ~50% coverage;
full Premier League coverage begins Aug 21. Guest JWTs are 30-day and
renewable without a wallet (`POST /auth/guest/start`); the API token
persists across JWT renewals.

**The replay window is rolling, not permanent.** The historical-scores
endpoint (`GET /api/scores/historical/{fixtureId}`) serves fixtures that
finished between roughly **2 weeks ago and 6 hours ago**. Fixtures older
than that return an empty stream, and `stat-validation` returns 404
(`A valid, processed scores record ... could not be found`). The World
Cup fixtures we demoed against (e.g. `18237038`, FRA-SPA semi-final) are
now outside the window — this is expected, not a regression.

Practical consequences:

- **Replay without a fixtureId auto-discovers** a fixture still in the
  window (finished fixtures in the current snapshot first, then known
  past fixtures in `PAST_FIXTURES`). If nothing is in window, the agent
  exits with a clear message and the options above.
- **To demo against a specific match**, capture a covered fixture that
  finished within the last ~2 weeks and pass its ID explicitly, or add
  it to `PAST_FIXTURES` in `apps/agent/src/index.ts`.
- **Live mode is unaffected** — the SSE stream and fixtures snapshot
  work for any currently-covered match regardless of age.
- **The settlement primitive is unaffected** — the CPI path, proof
  verification, and SDK consume whatever proof the API returns for a
  fixture in window; the borsh encoding and Merkle logic don't care
  which fixture.

### Agent observability

OpenTelemetry export to SigNoz is opt-in. See [OBSERVABILITY.md](./OBSERVABILITY.md).

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
npx tsx apps/agent/src/index.ts replay
```

Without the env var, the agent still logs structured JSON to stdout.

## Deployment

The frontend (`apps/web`) is hosted on **Vercel** — `git push` to `main`
automatically triggers a deploy. The autonomous agent (`apps/agent`) runs as a
PM2 process on the VPS (`nuncio-vultr`). The agent now serves match events via
an embedded HTTP server so the web app never needs shared filesystem access.

### Current devnet deployment

- Public URL: `https://stoppage.sportwarren.com` (Vercel)
- Agent API: `http://<VPS_IP>:18766` (VPS, internal — Vercel serverless
  functions reach it over the public internet)
- Agent service: PM2 process `stoppage-agent`

### Web app (Vercel)

1. Push to `main` — Vercel auto-deploys from the GitHub integration.
2. Set the following env vars in the Vercel dashboard (or `.env.production`):
   - `NEXT_PUBLIC_APP_URL` — public domain
   - `NEXT_PUBLIC_HELIUS_RPC_URL` — Helius RPC endpoint
   - `TXLINE_NETWORK`, `TXLINE_JWT`, `TXLINE_API_TOKEN` — server-only TxLINE
     credentials for the `/api/fixtures` proxy
   - `AGENT_API_URL` — `http://<VPS_IP>:18766` (the VPS IP, not the SSH alias — Vercel serverless can't resolve `nuncio-vultr`)
3. DNS: update the GoDaddy `A` record for `stoppage` to point to Vercel's edge
   network (follow Vercel's provided DNS target after adding the domain).

### Agent (VPS)

1. Clone the repo to `/home/linuxuser/stoppage` and run `npm ci`.
2. Copy `deploy/agent-config.example` to `.env.agent`, set mode `600`, and place
   a funded devnet-only agent keypair at the configured `SOLANA_KEYPAIR_PATH`.
3. Start the agent:

   ```bash
   set -a
   source .env.agent
   set +a
   pm2 start deploy/ecosystem.agent.config.cjs
   pm2 save
   ```

   The agent starts an internal HTTP server on port 18766 serving `GET /events`
   and `GET /health`. Port 18766 should allow inbound from Vercel's IP range.

4. Verify with `pm2 logs stoppage-agent` and check `GET /health`.

### Redeploying the agent

The web app auto-deploys on `git push` via Vercel. The agent does not —
use the one-command script from your laptop:

```bash
./scripts/agent-deploy.sh                   # pull + reinstall + restart + health checks
./scripts/agent-deploy.sh --logs    # same, then tail pm2 logs
./scripts/agent-deploy.sh --no-pull         # restart current code
./scripts/agent-deploy.sh --require-healthy # abort if not already healthy
```

The script SSHes to `nuncio-vultr`, pulls `origin/main` into
`/home/linuxuser/stoppage`, runs `npm ci`, restarts the PM2 process
with `--update-env`, and curls the health endpoint. Override the SSH
host or remote dir with `SSH_HOST=...` / `REMOTE_DIR=...` env vars.

`TXLINE_JWT`, `TXLINE_API_TOKEN`, and `TXLINE_NETWORK` are preferred at
runtime. The legacy `.txline-credentials.json` file remains supported for
local development only, but local ignored env files are the better backup
because they match production deployment semantics.

## Program tests

`npm run anchor:test` runs the Anchor test suite in `tests/` against a
local validator (`solana-test-validator`), which `anchor test` starts
automatically. The suite covers the M2 acceptance list: payout math,
double-claim, claim-before-settle, join-after-close, session-key join
with expired/revoked grant, cumulative-spend-cap breach, and the
side-mismatch guard. The void-after-grace-period path is skipped (needs
a clock-warp harness — see the test file note) and tracked in ROADMAP.

The first test calls `initialize_protocol` once, so the suite is also
the bootstrap: it creates `ProtocolConfig` + the treasury PDA. On devnet,
run the equivalent once after deploy (see the devnet runbook below).

## Devnet runbook (post-deploy bootstrap)

After `npm run deploy:programs` succeeds on devnet, the market program
needs a one-time `initialize_protocol` call before any market can be
created (every `create_market` reads `ProtocolConfig`). From a shell with
the deployer wallet as the Anchor provider:

```bash
# 1. Confirm the programs landed.
solana program show 92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG --url devnet
solana program show 5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF --url devnet

# 2. Initialize the protocol (one-time). Uses the Anchor provider wallet
#    (~/.config/solana/id.json) as the authority + fee payer.
#    fee_bps=25 = 0.25% protocol fee, capped at 500 (5%).
anchor run init-protocol --provider.cluster devnet   # if you add the script
# or, from the test harness against devnet (idempotent — safe to re-run):
anchor test --skip-build --provider.cluster devnet -- --grep "initializes the protocol"
```

Then the M1 acceptance flow (record this clip — it's the demo cold open):
1. `npm run dev`, open http://localhost:3000, connect Phantom (devnet).
2. Click "Delegate session key (one popup)" — approve once.
3. **Close the Phantom extension.**
4. Click "Ping with session key (no popup)" — a tx lands with no popup.
5. Browse to /markets, open a market, back YES — if a session key is
   delegated, the bet signs with no popup (the differentiator).

## Program-ID discipline

`keys/*-keypair.json` are the single source of truth. IDs appear in exactly
three other places — `declare_id!()`, `Anchor.toml`, and
`packages/sdk/src/programIds.ts` — all machine-written by `sync-ids.js` and
machine-checked by `check-ids.js`. Program IDs are never env vars and never
appear in docs as copy-paste values. This is a direct lesson from the
predecessor repo, which accumulated three divergent "live" program IDs.

## Toolchain traps (already handled, documented so nobody re-fights them)

1. **Homebrew cargo shadows rustup.** Anchor invokes `cargo +solana ...`;
   only rustup's cargo shim understands `+toolchain`. Every anchor script
   here prefixes `PATH="$HOME/.cargo/bin:$PATH"`. If you see
   ``error: no such command: `+solana` `` you're on Homebrew's cargo.

2. **edition2024 crates vs platform-tools cargo.** Solana's platform-tools
   ship cargo 1.84, which cannot parse `edition2024` manifests. The
   committed `Cargo.lock` pins the offenders (`zeroize 1.8.1`,
   `proc-macro-crate 3.2.0`, `indexmap 2.7.1`, `hashbrown 0.15.5`,
   `unicode-segmentation 1.12.0`). **Never delete Cargo.lock**; if you add
   a Rust dependency and the build starts demanding `edition2024` or rustc
   1.85, pin the new offender the same way:
   `cargo update <crate>@<ver> --precise <older-ver>`.

3. **IDL provenance.** The frontend/SDK only ever load IDLs from
   `packages/sdk/idl/`, which is written by `scripts/deploy.sh` from the
   same build that gets deployed. Never hand-edit an IDL, never maintain a
   TS mirror of one.

4. **rustup default toolchain must be set.** If `anchor build` fails with
   `rustup could not choose a version of cargo to run, because one wasn't
   specified explicitly, and no default is configured`, run
   `rustup default stable-x86_64-apple-darwin` (or your native triple).
   The `~/.cargo/bin` shims require a default; Homebrew's `/usr/local/bin/cargo`
   shadows them otherwise. Every anchor script here prefixes
   `PATH="$HOME/.cargo/bin:$PATH"`, but that only helps once a default
   toolchain exists for the shim to dispatch to.

5. **The Solana CLI install has been wiped twice** (Jul 28 and Aug 10,
   2026). Symptoms: `solana-keygen: command not found`,
   `~/.local/share/solana` absent, rustup `solana` link dangling
   (`override toolchain 'solana' is not installed`), and `anchor
   --version` failing with "error decoding response body" while
   auto-installing agave-install. Repair (worked Aug 10):
   `curl -sSfL https://release.anza.xyz/v2.3.0/install -o /tmp/agave.sh
   && sh /tmp/agave.sh`, then run `~/.local/share/solana/install/active_release/bin/cargo-build-sbf`
   once from the repo root — it re-downloads platform-tools and
   re-links rustup's `solana` toolchain itself (set
   `rustup default solana` afterwards). If `cargo-build-sbf` first
   fails on `cargo metadata`, temporarily
   `rustup default stable-aarch64-apple-darwin`, rerun, then switch back.
