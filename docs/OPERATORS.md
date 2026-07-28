# Operator Integration Guide

Stoppage is a **settlement primitive**, not a betting app. You bring the
markets and the oracle; Stoppage provides the one thing nobody else does:
fund release that is **cryptographically gated on an on-chain proof
verification**, in a single atomic transaction.

This guide is for an operator (a prediction-market protocol, a futarchy or
governance platform, a fantasy platform, a data vendor, an on-chain game)
that wants its markets to settle on a proof the settlement contract itself
verified, rather than on a multisig, an admin key, or a dispute window.

**If your resolution is a predicate over anchored data** —
`twap_pass > twap_fail * 1.05 over the window`, `feed_price >= threshold at
T`, `stat_total > N for fixture X` — **it fits this contract as-is.** The
settlement program does not care what the predicate is; it needs your
validator to return one bool over CPI.

The primitive is oracle-agnostic **in production, not on paper**: two
structurally different oracles are live on devnet today, settling through
the identical receipt path — TxLINE's Merkle-proof sports validator and a
Pyth guardian-verified price validator (`programs/pyth_validator`).

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
| Pyth validator | `73co8qb1DPiQP9zphReVNdsUPsHJZ5EoD3RpfKWUoQQG` | Reference price oracle: verifies a Pyth PriceUpdateV2 observation, returns bool |

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

### Reference oracle 2: Pyth (price feeds)

The deployed `pyth_validator` program settles `price_above` markets against
a Pyth PriceUpdateV2 account posted on-chain via pyth-solana-receiver
(guardian-signed). The keeper fetches the signed observation from Hermes
(free API), posts it on-chain, and the validator re-checks owner, account
discriminator, feed id, and publication window before returning the bool:

```ts
import { pythOracle, buildResolveMarketIxFromOracle, PYTH_FEED_IDS } from "@stoppage/sdk";

const ix = buildResolveMarketIxFromOracle(
  pythOracle,
  keeperWallet.publicKey,
  marketPda,
  "sol_above:74:1790000000",
  outcome,
  {
    priceUpdateAccount: postedUpdatePda, // PriceUpdateV2 posted via receiver
    feedId: PYTH_FEED_IDS["SOL/USD"],
    threshold: 74n * 10n ** 8n, // feed-native units (expo -8)
    referenceTs: market.closesAt,
    maxStalenessSeconds: 120,
    observedPrice: price,
    observedConf: conf,
    observedPublishTime: publishTime,
  }
);
```

Because price oracles have no Merkle root, the receipt's anchored-root
field carries a digest of the exact verified observation (account, feed,
price, conf, publish time) — the validator's CPI is the verification; the
digest is the audit trail.

### Bring your own oracle

Run your own validator (a Merkle-anchor program, a TWAP verifier for
futarchy resolution, a Chainlink adapter, or anything that returns a bool)
and settle through the identical receipt path. The market program never
learns which oracle produced the receipt:

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

## Current state (as of 2026-07-28)

- **Oracle-agnostic settlement is live on devnet.** Both programs were
  upgraded; the settlement and market programs support any validator via
  remaining_accounts, with market-oracle binding enforced on-chain. The
  oracle-agnostic CPI path has been exercised end-to-end with TxLINE as
  the reference validator.
- **Two reference oracles, one receipt path.** Sports markets settle via
  TxLINE's Merkle-proof `validate_stat`; price markets settle via the
  deployed `pyth_validator` program against Pyth PriceUpdateV2 accounts.
  Templates proven: `total_goals_over`, `corners_over`, `price_above`.
  New predicates need a deterministic mapping to a validator proof.
- **Devnet only.** Mainnet needs a legal review (see README compliance
  note) before any funds move there.
- **Claim is owner-signed.** Winners claim with their own wallet; there
  is no session-key claim instruction yet.
- **Validator args vs market params.** The settlement contract binds a
  market to its oracle *program*, not to the validator's argument bytes —
  a mismatched keeper could call `validate_price` with a threshold that
  disagrees with the market's `param_u64`. The receipt's `statement`
  field (emitted in `MarketResolved`) is the audit defense: it records
  the exact claim verified, and a keeper/console mismatch is visible
  on-chain as a contradiction between the event and the market account.
  A stricter binding (hashing validator args into the market PDA) is a
  known post-hackathon hardening item; the reference keepers build both
  from the same predicate object so they cannot drift.

## The loop to run first

1. Subscribe to a data source (TxLINE free tier, or your own feed).
2. Create a market with `buildCreateMarketIx`.
3. On resolution, fetch the proof, build the verify spec, and send the
   three-instruction settle transaction.
4. Winners claim; the receipt and event are the public proof.

One real operator settling one real market through their own validator is
the milestone. Not fifty seeded markets.
