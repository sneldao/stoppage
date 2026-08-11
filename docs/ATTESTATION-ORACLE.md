# Attestation Oracle (operator-signed sports settlement)

Status: deployed on devnet (2026-08-10). First live settlement target:
Orlando City vs FC Cincinnati, MLS, 2026-08-15 23:30 UTC.

The third oracle for the settlement primitive, after TxLINE (Merkle
proofs verified by TxODDS's program) and Pyth (Wormhole-guardian-signed
prices). It exists so the proof-gated loop can run on leagues TxLINE's
free bundle does not cover (MLS, Premier League) instead of idling until
the next covered Friendly. It is also the reference implementation for
"operators bring their own oracles" (docs/OPERATORS.md).

## Trust model — read this before reusing

The observation is signed by **one operator key**, pinned on-chain in
the validator's Config PDA. Unlike TxLINE or Pyth, there is no external
network attesting. What the primitive guarantees is unchanged:

- Fund release requires an **ed25519-precompile-verified** message from
  the pinned authority, matching the exact statistic, value, and time
  window claimed — **verified atomically in the same transaction** as
  settlement.

What it does NOT guarantee: that the operator's observation reflects
reality. That is the operator's reputation/stake problem, exactly as in
the operator-integration model. Demo and UI copy must say
"operator-attested settlement". Never imply decentralized verification.
The TxLINE Friendlies path (from Sept 23) remains the
third-party-verified milestone.

## Components

| Piece | Location | Role |
|---|---|---|
| `attestation_validator` program | `programs/attestation_validator/` | Verifies the precompile binding + predicate; returns bool over CPI |
| SDK adapter | `packages/sdk/src/oracle.ts` (`attestationOracle`) | Message builder, digest, instruction encoder, config init ix |
| Keeper mode | `apps/agent/src/attestationKeeper.ts` | Poll → sign → atomic settle bundle |
| Facts source | `apps/agent/src/attest/theSportsDB.ts` | TheSportsDB free API (agent-side; NOT in @stoppage/txline) |

## Verification mechanics

The bundle is one transaction:

```
ix[k-1]  ed25519 precompile: verifies signature over the message
ix[k]    settlement.resolve_market → CPI attestation_validator.validate_attestation
         └ reads [Config PDA, instructions sysvar]
         └ requires: preceding top-level ix IS the ed25519 precompile,
           self-contained offsets (u16::MAX), signer == config.authority,
           message byte-equal to the claimed observation args
         └ requires: obs_ts ∈ [reference_ts, reference_ts + window_seconds]
         └ returns bool via set_return_data
ix[k]    …continues: settle_from_proof + attest_verification (unchanged)
```

Signed message (66 bytes, encoded identically in Rust and the SDK —
covered by `packages/sdk/src/oracle.test.ts`):

```
"stoppage/attest-observation/v1" (30)
|| fixture_ref[16]        = sha256("tsdb:<eventId>")[..16]
|| stat_key (u32 LE)      = 1 (total_goals; registry in attestationKeeper)
|| value (i64 LE)         = observed total goals
|| obs_ts (i64 LE)        = observation unix time
```

Claim-side args (not signed; evaluated by the validator):
`op ∈ {0:>=, 1:<=, 2:==}`, `threshold`, `reference_ts`, `window_seconds`.
Current timing: `reference_ts = kickoff + 6300s` (earliest plausible
full-time ≈ 105 min), `window = 14400s`.

Replay reasoning: a valid (authority, message) pair only attests the
observation actually signed; the claim args and window bound where it
can be applied, and the market program consumes resolutions once — as
with every oracle.

The receipt's `merkle_root` field carries
`attestationObservationDigest(...)` (SDK) committing to
(authority, fixture_ref, stat_key, value, obs_ts, signature) — the audit
trail linking the receipt to one specific signature. Semantics parallel
to the Pyth digest: the CPI is the verification, the digest is the
trail.

## Operating the keeper

```bash
# one event per run; PM2 or relaunch on match day (it resumes)
npx tsx apps/agent/src/index.ts attest --event=<theSportsDbEventId> --line=2 --live-tx
```

- `--event` TheSportsDB event id (MLS league id 4346, EPL 4328;
  `eventsnextleague.php?id=4346` via the free v1 API key).
- `--line` integer goal line (strictly-greater-than semantics, matching
  the TxLINE strategy: `totalGoals > line`, i.e. validator claim
  `value >= line+1`). Default 2.
- Keeper wallet (`SOLANA_KEYPAIR_PATH`) pays bond + fees.
- Attestor key (`ATTESTOR_KEYPAIR_PATH`, default
  `secrets/attestor-keypair.json`) is auto-generated on first run and
  pinned in the Config PDA at first `initialize_config`. If the on-chain
  authority ever differs from the local key, the keeper refuses to run
  (settlement would revert with `SignerMismatch`).
- Boot failure to note: `create_market` requires kickoff in the future;
  pointing at an already-started match fails fast by design.

Predicate coverage: `total_goals_over` only. Corners/cards need a richer
source; `next_goal_within` needs the settle-on-event path (roadmap item,
unchanged by this oracle).
