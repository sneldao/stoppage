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

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import { PYTH_VALIDATOR_PROGRAM_ID } from "./programIds";
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
