# Stoppage

**Markets that live inside the match, not around it.**

Permissionless, session-key-native in-play sports micro-markets on Solana,
settled from TxLINE Merkle proofs. Built for the TxODDS World Cup track
(Superteam Earn).

## What it is

- **Session-key betting** — delegate once, bet during the match with no popup per stake.
- **Protocol, not sportsbook** — peer-funded vaults; settlement only after on-chain CPI into TxLINE `validate_stat`.
- **Proof-first UI** — every resolution shows the Merkle proof; Matchkeeper quotes are reproducible in-browser.

Differentiators, demo script, and judge-facing proof links: [docs/SUBMISSION.md](./docs/SUBMISSION.md).
Design and module boundaries: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quickstart

```bash
npm install
cp apps/web/.env.local.example apps/web/.env.local   # Helius, Shyft, TxLINE
npm run dev                                          # web on :3000
npm run anchor:build
```

Agent (dry-run replay):

```bash
npx tsx apps/agent/src/index.ts replay 18237038
```

Full toolchain, deploy, and agent ops: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Documentation

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Core flow, session keys, module boundaries |
| [DEVELOPMENT.md](./docs/DEVELOPMENT.md) | Toolchain, commands, deploy, env |
| [ROADMAP.md](./docs/ROADMAP.md) | Milestones, status, icebox, risks |
| [SUBMISSION.md](./docs/SUBMISSION.md) | Demo script, proof txs, TxLINE usage |
| [OBSERVABILITY.md](./docs/OBSERVABILITY.md) | SigNoz / OpenTelemetry for the agent |
| [hackathons.md](./docs/hackathons.md) | Hackathon fit notes (KeeperHub, SigNoz) |

Working rules for contributors: [CLAUDE.md](./CLAUDE.md).

## Compliance

Escrow and payout logic tied to real-world outcomes may trigger gambling
regulation if taken past devnet/hackathon scope. Nothing here is legal
advice — see the compliance section in [docs/SUBMISSION.md](./docs/SUBMISSION.md).
