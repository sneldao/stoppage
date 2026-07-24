# Operator Integration Guide

Stoppage is a **settlement primitive**, not a betting app. You bring the
markets and the oracle; Stoppage provides the one thing nobody else does:
fund release that is **cryptographically gated on an on-chain proof
verification**, in a single atomic transaction.

This guide is for an operator (a prediction-market protocol, a fantasy
platform, a data vendor, an on-chain game) that wants its markets to settle
on a proof the settlement contract itself verified, rather than on a
multisig, an admin key, or a dispute window.

## The promise

Every market that settles through Stoppage produces an immutable
`Resolution` receipt and a `MarketResolved` event carrying:

- the raw statement that was proven,
- the anchored Merkle root,
- the outcome (YES/NO/VOID),
- the resolver, and a timestamp.

Anyone can re-verify the proof against the anchored root without trusting
you or us. That receipt is the product. Your users settle on evidence,
not authority.

## Architecture (what you integrate)

```
Your keeper ──(SDK)──> settlement program ──CPI──> YOUR validator (returns bool)
                              │
                              └─> Resolution receipt (PDA per market)
                                        │
Your keeper ──(SDK)──> market program: settle_from_proof (consumes receipt)
```

Two programs, one-way data flow:

| Program | ID (devnet) | Job |
| --- | --- | --- |
| Market | `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG` | Vault, positions, session keys, fees, claim |
| Settlement | `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF` | CPI-verify a proof, mint the receipt, emit the event |

The settlement program never sets odds and never custodies funds. It
CPIs into a validator, reads a single boolean return ("did the predicate
hold against the anchored data?"), and binds that to an outcome. If the
CPI returns false-or-fails, the whole transaction reverts: **settlement is
the proof, there is no settle-without-proof path.**

## Your oracle: the only integration point

The settlement program is oracle-agnostic at the contract level. It needs
a validator that:

1. is a Solana program reachable by CPI,
2. returns a 1-byte bool (`0x01` = predicate holds) as return data,
3. reads its truth from an account carrying an anchored Merkle root.

You supply those three things through an `SettlementOracle` in the SDK.

### Reference oracle: TxLINE

The deployed Matchkeeper settles against TxLINE's `validate_stat`. If you
want sports markets with a proven oracle today, use it:

```ts
import { txlineOracle, buildResolveMarketIxFromOracle } from "@stoppage/sdk";

const ix = buildResolveMarketIxFromOracle(
  txlineOracle,
  keeperWallet.publicKey,
  marketPda,
  "total_goals_over:2.5:FRA-SPA",
  outcome, // 0 = YES, 1 = NO
  txlineProof // { txlineProgramId, epochDay, merkleRoot, validateStat }
);
```

### Bring your own oracle

Run your own validator (a Merkle-anchor program, a Chainlink/Pyth
adapter, or anything that returns a bool) and settle through the identical
receipt path. The market program never learns which oracle produced the
receipt:

```ts
import { genericOracle, buildResolveMarketIxFromOracle } from "@stoppage/sdk";

const ix = buildResolveMarketIxFromOracle(
  genericOracle,
  keeperWallet.publicKey,
  marketPda,
  "btc_above:70000:2026-08-01",
  outcome,
  {
    validatorProgram: MY_VALIDATOR_PROGRAM_ID,
    anchorAccounts: [myAnchoredRootPda],
    fullInstructionData: myBorshArgsWithDiscriminator,
    merkleRoot: anchoredRoot,
  }
);
```

Your keeper then bundles three instructions in one transaction:

1. `resolve_market` (settlement program — CPIs into your validator, mints receipt)
2. `settle_from_proof` (market program — consumes the receipt, flips status)
3. `attest_verification` (market program — increments the public verification counter)

If step 1's proof is invalid, the whole transaction reverts and nothing
settles.

## Current state (as of 2026-07-24)

- **Oracle-agnostic settlement is live on devnet.** Both programs were
  upgraded; the settlement and market programs support any validator via
  remaining_accounts, with market-oracle binding enforced on-chain. The
  oracle-agnostic CPI path has been exercised end-to-end with TxLINE as
  the reference validator.
- **Two market templates are proven** (`total_goals_over`,
  `corners_over`). New predicates need a deterministic mapping to a
  validator proof; the settlement program doesn't care what the predicate
  is, only that your validator returns a bool.
- **Devnet only.** Mainnet needs a legal review (see README compliance
  note) before any funds move there.
- **Claim is owner-signed.** Winners claim with their own wallet; there
  is no session-key claim instruction yet.

## The loop to run first

1. Subscribe to a data source (TxLINE free tier, or your own feed).
2. Create a market with `buildCreateMarketIx`.
3. On resolution, fetch the proof, build the verify spec, and send the
   three-instruction settle transaction.
4. Winners claim; the receipt and event are the public proof.

One real operator settling one real market through their own validator is
the milestone. Not fifty seeded markets.
