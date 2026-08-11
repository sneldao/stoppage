/**
 * Oracle-agnostic settlement interface — the operator integration surface.
 *
 * The settlement program (programs/settlement) CPIs into a validation
 * program and reads a single boolean return: did the predicate hold
 * against anchored data? The contract is oracle-agnostic: it needs a
 * program that returns a bool and the readonly account(s) carrying the
 * anchored root. The adapter supplies the COMPLETE instruction data
 * (discriminator + args) — the contract does not prepend anything.
 *
 * This module is where operators plug in their own oracle. A settlement
 * oracle is anything that can produce:
 *   1. the validator program id (receives the CPI),
 *   2. the readonly account(s) the validator reads (the anchored root),
 *   3. the complete instruction data to send (discriminator + borsh args),
 *   4. the anchored 32-byte root for the proof receipt + event.
 *
 * The TxLINE adapter (txlineOracle) is the reference implementation.
 * A second oracle (Chainlink, Pyth, a custom Merkle anchor program, or
 * an operator's own validator) implements the same `SettlementOracle`
 * interface and settles markets through the identical receipt path —
 * the market program never learns which oracle produced the receipt.
 *
 * Boundary (CLAUDE.md → Module boundaries): this builds instruction data
 * and PDAs only. No React, no Next, no wallet adapter.
 */

import { PublicKey, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import { ATTESTATION_VALIDATOR_PROGRAM_ID, PYTH_VALIDATOR_PROGRAM_ID } from "./programIds";
import { writeI64LE, writeU64LE } from "./escrow";
import {
  buildResolveMarketIx,
  buildTxlineValidateStatData,
  deriveDailyScoresRootsPda,
  type ScoresBatchSummary,
  type StatTerm,
  type TraderPredicate,
  type BinaryExpression,
} from "./settlement";

/**
 * What the settlement program needs from an oracle to CPI-verify a claim.
 *
 * The settlement program's job is fixed: CPI into the validator, read
 * the bool return, and bind it to an outcome. Everything oracle-specific
 * is supplied by the adapter that produces this spec.
 */
export interface OracleVerifySpec {
  /** Validator program that receives the CPI (e.g. the TxLINE program). */
  validatorProgram: PublicKey;
  /**
   * Readonly account(s) the validator reads to verify the proof — the
   * carrier of the anchored root. Order matters: these become the
   * remaining_accounts of the CPI, in order. For TxLINE this is the
   * daily_scores_merkle_roots PDA.
   */
  anchorAccounts: PublicKey[];
  /**
   * Complete validator instruction data (discriminator + borsh args).
   * The settlement program sends this verbatim in the CPI — no bytes
   * are prepended or appended.
   */
  instructionData: Buffer;
  /** The anchored 32-byte root, carried into the receipt + event. */
  merkleRoot: Uint8Array;
}

/**
 * A settlement oracle: turns an operator's proof into a verify spec the
 * settlement program can CPI against. One implementation per oracle.
 */
export interface SettlementOracle {
  /** Stable identifier for logs/diagnostics (e.g. "txline-devnet"). */
  readonly id: string;
  /** Produce the verify spec for a single outcome claim. */
  buildVerifySpec(params: VerifyParams): OracleVerifySpec;
}

/** Outcome claim an operator wants to settle. */
export interface VerifyParams {
  /** 0 = YES (predicate holds), 1 = NO (predicate does not hold). */
  outcome: number;
  /** Human-readable statement, e.g. "total_goals_over:2.5:FRA-SPA". */
  statement: string;
  /** Oracle-specific proof payload (opaque to the settlement program). */
  proof: unknown;
}

// ── TxLINE reference adapter ─────────────────────────────────────────

export interface TxlineProof {
  /** TxLINE program id (devnet or mainnet). */
  txlineProgramId: PublicKey;
  /** Epoch day for the daily_scores_merkle_roots PDA. */
  epochDay: number;
  /** Anchored root (from TxLINE's daily_scores_roots PDA). */
  merkleRoot: Uint8Array;
  /** Args for TxLINE's validate_stat (borsh args, without discriminator). */
  validateStat: {
    ts: number;
    fixtureSummary: ScoresBatchSummary;
    fixtureProof: { hash: Uint8Array; isRightSibling: boolean }[];
    mainTreeProof: { hash: Uint8Array; isRightSibling: boolean }[];
    predicate: TraderPredicate;
    statA: StatTerm;
    statB?: StatTerm | null;
    op?: BinaryExpression | null;
  };
}

/**
 * Reference oracle: TxLINE's `validate_stat` on Solana. This is what the
 * deployed Matchkeeper uses. The borsh encoding for the TxLINE types
 * lives in ./settlement (buildTxlineValidateStatData) — one source of
 * truth. The adapter prepends the 8-byte discriminator so the contract
 * can CPI verbatim.
 */
export const txlineOracle: SettlementOracle = {
  id: "txline",
  buildVerifySpec({ proof }): OracleVerifySpec {
    const p = proof as TxlineProof;
    const [dailyScoresRoots] = deriveDailyScoresRootsPda(
      p.txlineProgramId,
      p.epochDay
    );
    return {
      validatorProgram: p.txlineProgramId,
      anchorAccounts: [dailyScoresRoots],
      instructionData: buildTxlineValidateStatData(p.validateStat),
      merkleRoot: p.merkleRoot,
    };
  },
};

// ── Pyth price oracle adapter ────────────────────────────────────────

/**
 * The pyth-solana-receiver program (same address on mainnet and devnet).
 * https://docs.pyth.network/price-feeds/core/contract-addresses/solana
 */
export const PYTH_RECEIVER_PROGRAM_ID =
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

/** Well-known Pyth feed ids (hex, no 0x). Look up more on Hermes. */
export const PYTH_FEED_IDS: Record<string, string> = {
  "SOL/USD": "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "BTC/USD": "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "ETH/USD": "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

/** Feed exponent for the majors above (fractions of a USD cent). */
export const PYTH_MAJOR_FEED_EXPO = -8;

/**
 * sha256("global:validate_price")[..8] — the discriminator of
 * programs/pyth_validator's validate_price instruction.
 */
const PYTH_VALIDATE_PRICE_DISCRIMINATOR = Buffer.from([
  179, 145, 207, 177, 245, 253, 59, 19,
]);

/**
 * Proof payload for the Pyth price oracle. The on-chain fact the
 * validator CPIs against is a PriceUpdateV2 account posted by
 * pyth-solana-receiver (Wormhole guardian-signed); the observation
 * fields are carried into the receipt's audit digest.
 */
export interface PythProof {
  /** The PriceUpdateV2 account posted on-chain via pyth-solana-receiver. */
  priceUpdateAccount: PublicKey;
  /** Pyth feed id (hex string, no 0x). */
  feedId: string;
  /** Threshold in feed-native units (e.g. USD * 1e8 for the majors). */
  threshold: bigint;
  /** The market's closes_at — the observation must be at/after this. */
  referenceTs: number;
  /** Observation window after the reference (bounds keeper drift). */
  maxStalenessSeconds: number;
  /** Observed aggregate price in feed-native units. */
  observedPrice: bigint;
  /** Observed confidence interval in feed-native units. */
  observedConf: bigint;
  /** Observed publish_time (unix seconds). */
  observedPublishTime: number;
}

/**
 * The receipts-anchor digest for price settlements. Price oracles have no
 * Merkle root; the receipt's anchored-root field instead commits to the
 * exact observation the validator verified (account, feed, price, conf,
 * publish time). Verification of the bool happens in the CPI; this digest
 * is the audit trail linking the receipt to one specific verified update.
 */
export function pythObservationDigest(proof: {
  priceUpdateAccount: PublicKey;
  feedId: string;
  observedPrice: bigint;
  observedConf: bigint;
  observedPublishTime: number;
}): Uint8Array {
  const buf = Buffer.concat([
    Buffer.from("stoppage/pyth-observation/v1", "utf8"),
    proof.priceUpdateAccount.toBuffer(),
    Buffer.from(proof.feedId, "hex"),
    writeI64LE(proof.observedPrice),
    writeU64LE(proof.observedConf),
    writeI64LE(BigInt(proof.observedPublishTime)),
  ]);
  return new Uint8Array(sha256.arrayBuffer(buf));
}

/**
 * Pyth price oracle: settles `price_above` markets against a verified
 * PriceUpdateV2 account via the pyth_validator program. The instruction
 * data the settlement program CPIs verbatim is built here (rule 6: one
 * encoder, matching the Rust arg order in programs/pyth_validator).
 */
export const pythOracle: SettlementOracle = {
  id: "pyth",
  buildVerifySpec({ proof }): OracleVerifySpec {
    const p = proof as PythProof;
    const instructionData = Buffer.concat([
      PYTH_VALIDATE_PRICE_DISCRIMINATOR,
      Buffer.from(p.feedId, "hex"),
      writeI64LE(p.threshold),
      writeI64LE(BigInt(p.referenceTs)),
      (() => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(p.maxStalenessSeconds, 0);
        return buf;
      })(),
    ]);
    return {
      validatorProgram: new PublicKey(PYTH_VALIDATOR_PROGRAM_ID),
      anchorAccounts: [p.priceUpdateAccount],
      instructionData,
      merkleRoot: pythObservationDigest(p),
    };
  },
};

// ── Operator attestation oracle adapter ─────────────────────────────

/**
 * sha256("global:validate_attestation")[..8] — the discriminator of
 * programs/attestation_validator's validate_attestation instruction.
 */
const ATTESTATION_VALIDATE_DISCRIMINATOR = Buffer.from(
  sha256.array("global:validate_attestation").slice(0, 8)
);

/**
 * Signed observation message contract (byte-for-byte with the Rust
 * reconstruction in programs/attestation_validator — one format, two
 * encoders that MUST stay in lockstep; covered by oracle.test.ts):
 *
 *   "stoppage/attest-observation/v1" (30) || fixture_ref[16]
 *   || stat_key(u32 LE) || value(i64 LE) || obs_ts(i64 LE)
 */
export const ATTESTATION_MSG_PREFIX = Buffer.from(
  "stoppage/attest-observation/v1",
  "utf8"
);
export const ATTESTATION_MSG_LEN = 30 + 16 + 4 + 8 + 8;

/** Predicate operators — mirror programs/attestation_validator. */
export const ATTESTATION_OPS = { gte: 0, lte: 1, eq: 2 } as const;
export type AttestationOp = (typeof ATTESTATION_OPS)[keyof typeof ATTESTATION_OPS];

/** The observation the operator signs (the fact being attested). */
export interface AttestationObservation {
  /** 16-byte fixture reference, e.g. sha256("tsdb:<eventId>")[..16]. */
  fixtureRef: Uint8Array;
  /** Statistic scale key (opaque to the validator; registry lives in
   * the agent's attestation source module). */
  statKey: number;
  /** Observed value in the statistic's native integer units. */
  value: bigint;
  /** Observation timestamp (unix seconds). */
  obsTs: number;
}

/** Build the exact bytes the operator signs. Pure, no key material. */
export function buildAttestationMessage(o: AttestationObservation): Buffer {
  if (o.fixtureRef.length !== 16) {
    throw new Error("fixtureRef must be 16 bytes");
  }
  const msg = Buffer.alloc(ATTESTATION_MSG_LEN);
  ATTESTATION_MSG_PREFIX.copy(msg, 0);
  Buffer.from(o.fixtureRef).copy(msg, 30);
  msg.writeUInt32LE(o.statKey, 46);
  msg.writeBigInt64LE(o.value, 50);
  msg.writeBigInt64LE(BigInt(o.obsTs), 58);
  return msg;
}

/**
 * Proof payload for the attestation oracle. The on-chain facts the
 * validator CPIs against are (a) the Config PDA pinning the authority
 * and (b) the ed25519 precompile instruction that MUST immediately
 * precede the resolve_market instruction in the same transaction (the
 * agent bundle builder splices it in; the validator enforces position,
 * self-contained offsets, signer, and message equality).
 */
export interface AttestationProof extends AttestationObservation {
  /** The pinned authority that signed `buildAttestationMessage(...)`. */
  authority: PublicKey;
  /** 64-byte ed25519 signature over the observation message. Carried
   * into the receipt digest (the precompile ix, not this buffer, is
   * what the validator cryptographically checks). */
  signature: Uint8Array;
  /** The claim: comparison over the observed value. */
  op: AttestationOp;
  threshold: bigint;
  /** Claim window: obs_ts must satisfy
   * reference_ts <= obs_ts <= reference_ts + windowSeconds. */
  referenceTs: number;
  windowSeconds: number;
}

/** Derive the attestation validator's Config PDA. */
export function deriveAttestationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
}

/**
 * Build the one-time initialize_config instruction for the attestation
 * validator. First-init-wins: the Config PDA pins the operator authority
 * whose ed25519 signatures the validator accepts. Returns null if the
 * config already exists (caller checks on-chain state first — this
 * guards against racing a successful init, not against a malicious one:
 * the transaction would fail on-chain anyway).
 */
export function buildInitializeAttestationConfigIx(
  payer: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const programId = new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID);
  const [configPda] = deriveAttestationConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(sha256.array("global:initialize_config").slice(0, 8)),
      authority.toBuffer(),
    ]),
  });
}

/**
 * The receipts-anchor digest for attestation settlements. Attestations
 * have no Merkle root; the receipt's anchored-root field instead commits
 * to the exact attested observation (authority, payload, signature) —
 * the audit trail linking the receipt to one specific signature.
 */
export function attestationObservationDigest(proof: {
  authority: PublicKey;
  fixtureRef: Uint8Array;
  statKey: number;
  value: bigint;
  obsTs: number;
  signature: Uint8Array;
}): Uint8Array {
  if (proof.signature.length !== 64) {
    throw new Error("signature must be 64 bytes");
  }
  const statKeyBuf = Buffer.alloc(4);
  statKeyBuf.writeUInt32LE(proof.statKey, 0);
  const buf = Buffer.concat([
    Buffer.from("stoppage/attestation-observation/v1", "utf8"),
    proof.authority.toBuffer(),
    Buffer.from(proof.fixtureRef),
    statKeyBuf,
    writeI64LE(proof.value),
    writeI64LE(BigInt(proof.obsTs)),
    Buffer.from(proof.signature),
  ]);
  return new Uint8Array(sha256.arrayBuffer(buf));
}

/**
 * Attestation oracle: settles markets against an operator-signed
 * observation verified via the ed25519 precompile (same transaction).
 * The instruction data the settlement program CPIs verbatim is built
 * here (rule 6: one encoder, matching the Rust arg order in
 * programs/attestation_validator).
 */
export const attestationOracle: SettlementOracle = {
  id: "attestation",
  buildVerifySpec({ proof }): OracleVerifySpec {
    const p = proof as AttestationProof;
    const windowBuf = Buffer.alloc(4);
    windowBuf.writeUInt32LE(p.windowSeconds, 0);
    const statKeyBuf = Buffer.alloc(4);
    statKeyBuf.writeUInt32LE(p.statKey, 0);
    const instructionData = Buffer.concat([
      ATTESTATION_VALIDATE_DISCRIMINATOR,
      Buffer.from(p.fixtureRef),
      statKeyBuf,
      Buffer.from([p.op]),
      writeI64LE(p.threshold),
      writeI64LE(p.value),
      writeI64LE(BigInt(p.obsTs)),
      writeI64LE(BigInt(p.referenceTs)),
      windowBuf,
    ]);
    const [configPda] = deriveAttestationConfigPda(
      new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID)
    );
    return {
      validatorProgram: new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID),
      anchorAccounts: [configPda, SYSVAR_INSTRUCTIONS_PUBKEY],
      instructionData,
      merkleRoot: attestationObservationDigest(p),
    };
  },
};

// ── Generic adapter for an operator's own validator ──────────────────

export interface GenericProof {
  validatorProgram: PublicKey;
  anchorAccounts: PublicKey[];
  /**
   * Complete instruction data for the validator, INCLUDING its
   * 8-byte discriminator. The contract CPIs this verbatim — nothing
   * is prepended.
   */
  instructionData: Buffer;
  merkleRoot: Uint8Array;
}

/**
 * Operator-supplied oracle. Use this when you run your own validator
 * program that returns a bool from a CPI: hand the settlement program
 * the validator id, the account(s) it reads, and the complete
 * instruction data. Nothing about this path is TxLINE-specific — the
 * settlement program treats every oracle identically.
 */
export const genericOracle: SettlementOracle = {
  id: "generic",
  buildVerifySpec({ proof }): OracleVerifySpec {
    const p = proof as GenericProof;
    return {
      validatorProgram: p.validatorProgram,
      anchorAccounts: p.anchorAccounts,
      instructionData: p.instructionData,
      merkleRoot: p.merkleRoot,
    };
  },
};

// ── High-level resolve builder ───────────────────────────────────────

/**
 * Build a resolve_market instruction from an oracle's verify spec.
 *
 * This is the single entry point an operator's keeper calls to settle a
 * market via proof-gated CPI. Swap `oracle` to change the data source;
 * the market program, receipt PDA, and event shape never change.
 */
export function buildResolveMarketIxFromOracle(
  oracle: SettlementOracle,
  resolver: PublicKey,
  market: PublicKey,
  statement: string,
  outcome: number,
  proof: unknown
): TransactionInstruction {
  const spec = oracle.buildVerifySpec({ outcome, statement, proof });
  return buildResolveMarketIx(
    resolver,
    market,
    spec.validatorProgram,
    spec.anchorAccounts,
    statement,
    spec.merkleRoot,
    outcome,
    spec.instructionData
  );
}
