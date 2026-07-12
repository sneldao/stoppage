# Development

## Prerequisites

- Node >= 18, npm (workspaces)
- Rust via **rustup** (the Homebrew rust formula will not work — see below)
- Solana CLI 2.3+ / Anchor CLI 0.32.1 (pinned in Anchor.toml; `npm run check:ids` verifies)

## Commands

```bash
npm install              # workspace install (apps/web + packages/sdk)
npm run dev              # Next.js dev server
npm run build            # production web build
npm run typecheck        # tsc over apps/web (includes the sdk via paths)
npm run check:ids        # assert all program-ID sources agree
npm run sync:ids         # rewrite all ID references from keys/*.json
npm run anchor:build     # build both programs
npm run deploy:programs  # the ONLY supported deploy path (scripts/deploy.sh)
```

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
