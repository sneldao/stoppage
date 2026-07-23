# Stoppage

**Settlement you can verify, not just trust.**

The first settlement primitive where fund release is cryptographically gated
on an on-chain proof verification. A market can resolve only after the
settlement program CPIs into TxLINE's `validate_stat` instruction and
confirms the Merkle proof inside the same transaction that releases the
vault. No oracle's word, no multisig, no admin key — the proof is the
authority.

Built on Solana. Session-key-native for frictionless in-play betting.
Open-source verifiable quant pricing. The reference UI is a betting app;
the product is the settlement layer.

## Why this exists

Every existing sports market protocol on Solana settles from an off-chain
oracle: a multisig signs, a token-staked committee votes, or an admin key
overrides. None can show you the cryptographic proof that the score was 2-1
*and* that the proof was verified inside the transaction that released the
funds. Stoppage can.

The moat is the schlep: encoding TxLINE's borsh types (ScoreStat,
StatTerm, ProofNode, TraderPredicate) into the exact byte format
`validate_stat` expects, aligning fixture IDs / sequence numbers / stat
keys / JWT credentials, and building the CPI path that makes proof
verification a settlement precondition, not a courtesy. This is painful,
un-tutorializable work — which is why no one else has done it.

A second proof surface runs alongside settlement: a verifiable quant
market-maker. Matchkeeper prices each market from a deterministic,
seeded Monte Carlo model, anchors the quote inputs (snapshot hash +
model version) on-chain in a `PricingReceipt`, and signs the quote with
its Ed25519 key. The "Verify this price" button re-runs the open model
against the anchored snapshot in the browser and confirms the on-chain
fair value reproduces. Web2 sportsbooks cannot do this. The model is
not just open-source — it is reproducible against the exact inputs that
produced the on-chain price.

## What it is

- **Proof-gated settlement** — `resolve_market` CPIs into TxLINE
  `validate_stat`, reads the boolean return, and emits a proof-carrying
  `MarketResolved` event. A failed proof reverts the entire transaction.
  `settle_from_proof` is permissionless but accepts only the canonical
  receipt PDA. No authority-only settlement path exists.
- **Session-key betting** — delegate once, bet during the match with no
  popup per stake. The session key actually signs (not decorative
  delegation); `signWithSessionKey` uses the local keypair, full stop.
- **Protocol, not sportsbook** — peer-funded vaults; no house book, no
  odds-setting. Odds are derived from vault balances.
- **Proof-first UI** — every resolution shows the Merkle proof, the CPI
  return data, and the Explorer link. Matchkeeper quotes are
  reproducible in-browser.
- **Operator-facing** — the settlement program + SDK are designed as
  infrastructure that other betting protocols can integrate. The
  reference UI proves the loop; the SDK is the product surface for
  operators.

Differentiators, demo script, and judge-facing proof links: [docs/SUBMISSION.md](./docs/SUBMISSION.md).
Design and module boundaries: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
Strategic direction and expansion path: [docs/ROADMAP.md](./docs/ROADMAP.md).

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
| [ROADMAP.md](./docs/ROADMAP.md) | Strategic direction, milestones, status, icebox, risks |
| [SUBMISSION.md](./docs/SUBMISSION.md) | Demo script, proof txs, TxLINE usage |
| [OBSERVABILITY.md](./docs/OBSERVABILITY.md) | SigNoz / OpenTelemetry for the agent |
| [hackathons.md](./docs/hackathons.md) | Hackathon fit notes (KeeperHub, SigNoz) |

Working rules for contributors: [CLAUDE.md](./CLAUDE.md).

## Compliance

Escrow and payout logic tied to real-world outcomes may trigger gambling
regulation if taken past devnet/hackathon scope. Nothing here is legal
advice — see the compliance section in [docs/SUBMISSION.md](./docs/SUBMISSION.md).
