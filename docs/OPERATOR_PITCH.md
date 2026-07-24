# Stoppage — the proof-gated settlement primitive

**One line:** Stoppage settles markets only when an on-chain proof verifies — no admin keys, no multisigs, no dispute windows. Your users settle on evidence, not authority.

## What you get

You bring the markets and the oracle. We provide the settlement contract that CPIs into your validator, reads a single boolean return ("did the predicate hold against the anchored data?"), and gates fund release on that proof — in one atomic transaction.

If the proof fails, the transaction reverts. Settlement is the proof; there is no settle-without-proof path.

## Why it matters

Every settled market produces an immutable receipt and a public event carrying:

- the raw statement proven,
- the anchored Merkle root,
- the outcome (YES/NO/VOID),
- the resolver, timestamp.

Anyone can re-verify the proof without trusting you or us. That receipt is your marketing artifact, your audit trail, and your trust differentiator.

## The contract

Two Solana programs, one-way data flow:

| Program | Job |
| --- | --- |
| **Market** | Vault, positions, session keys, protocol fees, claim |
| **Settlement** | CPI-verify a proof, mint the receipt, emit the event |

Settlement never sets odds, never custodies funds. It only verifies.

## Your oracle, your choice

The settlement program is oracle-agnostic at the contract level. It needs:

1. a Solana program reachable by CPI,
2. a 1-byte bool return (`0x01` = predicate holds),
3. an account carrying an anchored Merkle root.

**Reference implementation:** TxLINE's `validate_stat` for sports markets (deployed and verified on devnet).

**Your validator:** run your own Merkle-anchor program, a Chainlink/Pyth adapter, or anything that returns a bool. Swap the oracle adapter in the SDK; the market program never learns which oracle produced the receipt.

## Integration surface

Three instructions in one transaction:

```
resolve_market        (settlement — CPIs your validator, mints receipt)
settle_from_proof     (market — consumes receipt, flips status)
attest_verification   (market — increments public verification counter)
```

SDK builders handle PDA derivation, borsh encoding, and account metas. Your keeper fetches the proof, builds the verify spec, and sends the transaction. Winners claim; the receipt is the public proof.

## Current state (2026-07-24)

- **Oracle-agnostic settlement upgrade is code-complete.** Market and settlement programs now support any validator program via remaining_accounts, with market-oracle binding enforced on-chain. The upgrade is ready for deployment but has not yet been pushed to devnet.
- **SDK complete.** Instruction builders, PDA derivations, oracle adapters (TxLINE reference + generic for custom validators).
- **Two market templates proven** (`total_goals_over`, `corners_over`). New predicates need a deterministic mapping to a validator proof.
- **Devnet only.** Mainnet requires legal review.

## The milestone

One real operator settling one real market through their own validator. Not fifty seeded markets. One proof-gated settlement that a user can verify themselves.

## Get started

→ [Operator Integration Guide](./OPERATORS.md) — architecture, oracle adapters, current limitations, the loop to run first.

**Contact:** [your email / Discord / Telegram]
