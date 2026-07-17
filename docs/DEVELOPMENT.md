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

### Agent commands

```bash
# Dry-run replay (default — no on-chain txs, safe for testing):
npx tsx apps/agent/src/index.ts replay 18237038

# Live transactions on devnet (requires funded wallet + Helius RPC):
npx tsx apps/agent/src/index.ts live --live-tx

# TxLINE subscription (one-time, saves credentials to .txline-credentials.json):
npx tsx scripts/subscribe-txline.ts
```

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
