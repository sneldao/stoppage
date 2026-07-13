# Stoppage — working rules

Read this before changing anything. These rules exist because the
predecessor project (pir8) died of exactly the failures they prevent.
Full context: docs/ARCHITECTURE.md (design), docs/DEVELOPMENT.md
(toolchain), docs/ROADMAP.md (what to build next and what NOT to build).

## Hard rules (violating any of these is a bug, not a style choice)

1. **Program IDs have one source of truth: `keys/*-keypair.json`.**
   Never type a program ID into code, docs, or env files. `npm run
   sync:ids` writes the three sanctioned locations; `npm run check:ids`
   must pass before any commit that touches them. Program IDs are never
   env vars.

2. **IDLs are build artifacts, only ever loaded from `packages/sdk/idl/`,
   only ever written by `scripts/deploy.sh`.** Never hand-edit an IDL,
   never maintain a TypeScript mirror of one, never copy one from a chat
   window. If the IDL and the deployed program can disagree, they will.

3. **Deploy only via `scripts/deploy.sh`.** No ad-hoc `anchor deploy`, no
   Solana Playground. The script exists so the deployed binary, the IDL
   the client loads, and the configured ID always come from one build.

4. **Payouts move lamports directly** (`try_borrow_mut_lamports` on the
   vault + recipient), never via System Program CPI from a program-owned
   PDA — the System Program cannot debit accounts it doesn't own. pir8
   shipped that bug and its escrow could collect but never pay out.

5. **The session key must actually sign.** If any code path in the
   betting flow calls `wallet.signTransaction()` after delegation, the
   differentiator does not exist. `signWithSessionKey` signs with the
   local keypair, full stop. (pir8's session key was authorized on-chain
   and then never used — decorative.)

6. **One implementation per concern.** No parallel copies of engines,
   constants, or types "for later" (pir8 carried a stale 2,500-line
   duplicate engine and three copies of its constants). If you refactor,
   delete the old version in the same commit. If code is dead, remove it
   — git remembers.

7. **Toolchain is pinned: Anchor 0.32.1, committed Cargo.lock.** Do not
   upgrade Anchor, Solana CLI, or lockfile pins during the hackathon
   window. If a new Rust dep triggers `edition2024` errors, pin it down
   (see docs/DEVELOPMENT.md) rather than upgrading the toolchain.

8. **The TxLINE credit token is read/validate only.** Never use it for
   staking, wagering, or P2P transfer — locked to TxODDS per the bounty
   rules. Stakes are SOL (devnet) in market vaults.

## Module boundaries (import direction is one-way)

```
programs/  (Rust — knows nothing about TS)
    ↑ IDL via deploy.sh
packages/sdk   — the ONLY TS that builds instructions, derives PDAs,
                 loads IDLs, or verifies proofs. No React, no Next.
    ↑
apps/web       — UI, hooks, store, API routes. Talks to the chain
                 exclusively through @stoppage/sdk. Components never
                 build transactions.
```

- New chain functionality lands in the SDK first, with the web app as a
  thin consumer. If a component imports `@solana/web3.js` to construct
  instructions, it's in the wrong layer (wallet-adapter plumbing in
  `lib/wallet` and `components/WalletProvider.tsx` is the exception).
- `apps/web/lib/*` is browser-facing glue (wallet, helius, session-key
  hook). `apps/web/store/*` is zustand slices only — no I/O in slices;
  fetching lives in hooks/SDK and results are written into the store.

## Scope discipline

The roadmap (docs/ROADMAP.md) is the only backlog. Ideas that aren't on
it go into its Icebox section, not into the codebase. pir8 accumulated
four abandoned pivots' worth of code (agent platform, Zcash education,
privacy sim, duplicate mobile stacks); each felt small at the time.

Status claims ("live", "deployed", "working") belong in ROADMAP.md only —
never in README or code comments, where they rot. The README describes
what the thing IS; the roadmap describes what state it's in.

## Verification bar

- `npm run build` and `npm run check:ids` green before every commit.
- Anything touching programs: `npm run anchor:build` green, and program
  tests once they exist (M2+).
- A feature is "done" when exercised end-to-end on devnet, not when it
  compiles. The demo-critical path (delegate → bet with no popup →
  settle → claim → verify proof) gets re-run after any change to it.
