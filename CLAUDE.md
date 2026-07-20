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

9. **Session grants offer optional self-imposed limits and always
   track spending.** `max_total_stake` on `SessionGrant` is a
   user-set behavioral limit, not a protocol-imposed one: `0` means
   "no cap" (the user's explicit choice), any other value is a
   self-imposed limit the protocol enforces. `join_via_session_key`
   must always increment `staked_so_far` (transparency) and only
   enforce the cap check when `max_total_stake > 0`. The real
   financial guardrail is `fund_lamports` — the session key can only
   spend what it's been funded with. The UI defaults to *suggesting*
   a limit (nudge, not mandate) but allows "no limit" as a clear
   opt-out. The session expiry (`expires_at`) is the cool-off
   mechanism: re-delegation after expiry is a conscious
   re-commitment, not an automatic renewal. `revoke_session_key` is
   the self-exclude path and must remain prominent in the UI, not
   buried. `pause` (disable one-tap locally, keep the keypair
   persisted so `revoke` stays reachable, no on-chain revoke, no
   popup) is a separate, non-destructive quick opt-out; it is NOT a
   substitute for `revoke_session_key`. Both must be reachable from
   the bet slip and the onboarding prompt, in both the active and
   paused states: **Pause** (instant, reversible) and **End session**
   (on-chain revoke, self-exclude).

## Module boundaries (import direction is one-way)

```
programs/  (Rust — knows nothing about TS)
    ↑ IDL via deploy.sh
packages/sdk     — the ONLY TS that builds instructions, derives PDAs,
                   loads IDLs, or verifies proofs. No React, no Next.
packages/txline  — TxLINE API client (auth, SSE, fixtures, validation
                   proofs, normalizer). No React, no Next, no chain.
    ↑
apps/agent       — Autonomous agent: TxLINE events → market create/settle.
                   Talks to the chain via @stoppage/sdk, to TxLINE via
                   @stoppage/txline. No UI.
apps/web         — UI, hooks, store, API routes. Talks to the chain
                   exclusively through @stoppage/sdk. Components never
                   build transactions.
```

- New chain functionality lands in the SDK first, with the web app as a
  thin consumer. If a component imports `@solana/web3.js` to construct
  instructions, it's in the wrong layer (wallet-adapter plumbing in
  `lib/wallet` and `components/WalletProvider.tsx` is the exception).
- `apps/web/lib/*` is browser-facing glue (wallet, helius, session-key
  hook, share, format). `apps/web/store/*` is zustand slices only — no
  I/O in slices; fetching lives in hooks/SDK and results are written
  into the store.
- `packages/txline` is the ONLY package that makes raw HTTP calls to
  TxLINE endpoints. No raw fetch to TxLINE elsewhere in the codebase.

## Build principles

These sit below the hard rules as day-to-day defaults. Where a principle
and a hard rule overlap, the hard rule wins and the principle is just the
reminder. pir8's codebase violated every one of these by the end.

- **Enhancement first.** Extend an existing program/module/component before
  creating a new one. A second market program "for later" is the bug rule 6
  forbids; a second session-key hook is the same shape. If you reach for a
  new file, ask first whether an existing one is the right home.
- **Delete, don't deprecate.** No `old/`, no `_v2`, no "kept for reference."
  When you refactor, the old version dies in the same commit (rule 6). Dead
  code is a liability, not a safety net — git is the safety net.
- **Audit before adding.** Before a new feature, scan for the duplication
  it would create. pir8 carried three copies of its constants and a
  2,500-line stale engine because each addition felt small. If the new
  thing overlaps existing logic, consolidate first.
- **One source of truth (DRY).** Shared logic lives in exactly one module
  and is imported, not copied. Program IDs already enforce this (rule 1);
  apply the same standard to constants, types, PDA seeds, and predicate
  evaluators. A type defined in two places will drift.
- **Explicit dependencies, one direction.** The module boundary diagram
  above is the law: `programs → sdk → web`, never sideways or back. If a
  component needs chain data, it goes through `@stoppage/sdk`; if the SDK
  needs UI, it's in the wrong layer. Dependencies are declared in
  `package.json`/`Cargo.toml`, not smuggled via dynamic imports.
- **Composable, testable modules.** Each SDK function builds one thing
  (an instruction, a PDA, a proof) and is unit-testable without a wallet
  or a browser. The web layer composes them; it doesn't reimplement them.
  Programs are tested with Anchor's test harness; SDK functions are tested
  with a plain `Connection` against devnet or a local validator.
- **Performance is a feature.** Lazy-load heavy client code (the IDL, the
  wallet adapters), cache account fetches, and prefer one Helius
  subscription over polling. In-play betting is latency-sensitive — a UI
  that blocks on a full account scan before rendering odds loses the demo.
- **Predictable, domain-driven layout.** Files live where the domain
  naming says: `lib/session-key/` for session-key glue, `store/marketsSlice`
  for market state, `packages/sdk/src/proofs` for proof logic. New code
  follows the existing pattern; if you can't tell where something belongs,
  the layout is wrong and should be fixed, not worked around.

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
