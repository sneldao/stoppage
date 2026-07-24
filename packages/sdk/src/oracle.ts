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
