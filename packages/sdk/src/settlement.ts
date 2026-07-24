/**
 * Settlement program instruction builders.
 *
 * buildResolveMarketIx builds the resolve_market instruction that CPIs
 * into an operator's validator program. Oracle-agnostic at the contract
 * level: the validator program id and the readonly anchor accounts it
 * reads are passed in `remaining_accounts`. The SDK keeps TxLINE's
 * `validate_stat` borsh-encoding as a reference adapter; an operator's
 * own validator implements the same shape (returns 1-byte bool from a
 * CPI).
 *
 * The TxLINE types are serialized manually using borsh conventions:
 *   - integers: little-endian
 *   - bool: 1 byte (0/1)
 *   - Option<T>: 1 byte (0=None, 1=Some) + T
 *   - Vec<T>: 4 bytes length (LE) + items
 *   - [u8; 32]: 32 raw bytes
 *   - enums: 1 byte variant index + variant fields
 */

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { SETTLEMENT_PROGRAM_ID } from "./programIds";

// TxLINE validate_stat instruction discriminator (from the TxLINE IDL).
// The settlement program no longer prepends this — the SDK's TxLINE
// oracle adapter does, since the contract is now oracle-agnostic.
const TXLINE_VALIDATE_STAT_DISCRIMINATOR = Buffer.from([
  107, 197, 232, 90, 191, 136, 105, 185,
]);

/**
 * Reference oracle program IDs. Operators building with the SDK can use
 * these to bind markets to the TxLINE oracle without importing
 * @stoppage/txline directly. The settlement program is oracle-agnostic —
 * any validator program works — but TxLINE is the reference integration.
 */
export const TXLINE_ORACLE_PROGRAM_IDS: Record<string, string> = {
  devnet: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  mainnet: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
};

/** Default oracle for devnet (TxLINE). Used by the web app and demo scripts. */
export const DEFAULT_ORACLE = new PublicKey(TXLINE_ORACLE_PROGRAM_IDS.devnet);

// ── TxLINE type encoders ────────────────────────────────────────────

/**
 * ProofNode as expected by the on-chain program:
 *   hash: [u8; 32] (32 bytes)
 *   is_right_sibling: bool (1 byte)
 * Total: 33 bytes per node.
 */
function encodeProofNode(node: { hash: Uint8Array; isRightSibling: boolean }): Buffer {
  const buf = Buffer.alloc(33);
  buf.set(node.hash, 0);
  buf.writeUInt8(node.isRightSibling ? 1 : 0, 32);
  return buf;
}

function encodeVec(items: Buffer[]): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(items.length, 0);
  return Buffer.concat([len, ...items]);
}

function encodeI64(val: number): Buffer {
  const buf = Buffer.alloc(8);
  // Write as two 32-bit parts to handle full i64 range
  buf.writeInt32LE(val & 0xffffffff, 0);
  buf.writeInt32LE(Math.floor(val / 0x100000000), 4);
  return buf;
}

function encodeI32(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(val, 0);
  return buf;
}

function encodeU32(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val, 0);
  return buf;
}

function encodeU8(val: number): Buffer {
  return Buffer.from([val & 0xff]);
}

function encodeBool(val: boolean): Buffer {
  return Buffer.from([val ? 1 : 0]);
}

function encodeOption<T>(val: T | null | undefined, encoder: (v: T) => Buffer): Buffer {
  if (val === null || val === undefined) {
    return Buffer.from([0]);
  }
  return Buffer.concat([Buffer.from([1]), encoder(val)]);
}

// ── TxLINE type structs ─────────────────────────────────────────────

interface ScoreStat {
  key: number; // u32
  value: number; // i32
  period: number; // i32
}

interface ScoresUpdateStats {
  updateCount: number; // i32
  minTimestamp: number; // i64
  maxTimestamp: number; // i64
}

interface ScoresBatchSummary {
  fixtureId: number; // i64
  updateStats: ScoresUpdateStats;
  eventsSubTreeRoot: Uint8Array; // [u8; 32]
}

interface ProofNode {
  hash: Uint8Array; // [u8; 32]
  isRightSibling: boolean;
}

interface StatTerm {
  statToProve: ScoreStat;
  eventStatRoot: Uint8Array; // [u8; 32]
  statProof: ProofNode[];
}

enum Comparison {
  GreaterThan = 0,
  LessThan = 1,
  EqualTo = 2,
}

interface TraderPredicate {
  threshold: number; // i32
  comparison: Comparison;
}

enum BinaryExpression {
  Add = 0,
  Subtract = 1,
}

// ── Encoders for structs ────────────────────────────────────────────

function encodeScoreStat(s: ScoreStat): Buffer {
  return Buffer.concat([encodeU32(s.key), encodeI32(s.value), encodeI32(s.period)]);
}

function encodeScoresUpdateStats(s: ScoresUpdateStats): Buffer {
  return Buffer.concat([
    encodeI32(s.updateCount),
    encodeI64(s.minTimestamp),
    encodeI64(s.maxTimestamp),
  ]);
}

function encodeScoresBatchSummary(s: ScoresBatchSummary): Buffer {
  return Buffer.concat([
    encodeI64(s.fixtureId),
    encodeScoresUpdateStats(s.updateStats),
    Buffer.from(s.eventsSubTreeRoot),
  ]);
}

function encodeStatTerm(s: StatTerm): Buffer {
  return Buffer.concat([
    encodeScoreStat(s.statToProve),
    Buffer.from(s.eventStatRoot),
    encodeVec(s.statProof.map(encodeProofNode)),
  ]);
}

function encodeTraderPredicate(p: TraderPredicate): Buffer {
  return Buffer.concat([encodeI32(p.threshold), encodeU8(p.comparison)]);
}

function encodeBinaryExpression(e: BinaryExpression): Buffer {
  return encodeU8(e);
}

// ── validate_stat instruction data builder ──────────────────────────

/**
 * Build the instruction data for TxLINE's validate_stat instruction.
 *
 * This is the data AFTER the 8-byte discriminator (the settlement
 * program prepends the discriminator). The args are:
 *   ts: i64
 *   fixture_summary: ScoresBatchSummary
 *   fixture_proof: Vec<ProofNode>
 *   main_tree_proof: Vec<ProofNode>
 *   predicate: TraderPredicate
 *   stat_a: StatTerm
 *   stat_b: Option<StatTerm>
 *   op: Option<BinaryExpression>
 */
export function buildValidateStatData(params: {
  ts: number;
  fixtureSummary: ScoresBatchSummary;
  fixtureProof: ProofNode[];
  mainTreeProof: ProofNode[];
  predicate: TraderPredicate;
  statA: StatTerm;
  statB?: StatTerm | null;
  op?: BinaryExpression | null;
}): Buffer {
  return Buffer.concat([
    encodeI64(params.ts),
    encodeScoresBatchSummary(params.fixtureSummary),
    encodeVec(params.fixtureProof.map(encodeProofNode)),
    encodeVec(params.mainTreeProof.map(encodeProofNode)),
    encodeTraderPredicate(params.predicate),
    encodeStatTerm(params.statA),
    encodeOption(params.statB ?? null, encodeStatTerm),
    encodeOption(params.op ?? null, encodeBinaryExpression),
  ]);
}

// ── resolve_market instruction builder ──────────────────────────────

/**
 * Derive the daily_scores_merkle_roots PDA for TxLINE.
 *
 * Seeds: ["daily_scores_roots", epoch_day_u16_le]
 */
export function deriveDailyScoresRootsPda(
  txlineProgramId: PublicKey,
  epochDay: number
): [PublicKey, number] {
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(epochDay, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), seed],
    txlineProgramId
  );
}

/** One immutable proof receipt is created for each resolved market. */
export function deriveResolutionPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("resolution"), market.toBuffer()],
    new PublicKey(SETTLEMENT_PROGRAM_ID)
  );
}

/**
 * Build the resolve_market instruction for the settlement program.
 *
 * Oracle-agnostic: the validator program id and its readonly accounts
 * are passed via remaining_accounts. The caller is responsible for
 * building the complete validator instruction data (discriminator + args).
 *
 * For TxLINE, use buildTxlineValidateStatData which includes the discriminator.
 *
 * @param resolver - The keeper/agent wallet (permissionless)
 * @param market - The market account to resolve
 * @param validatorProgram - The oracle validator program id
 * @param validatorAccounts - Readonly accounts the validator reads (e.g., merkle roots)
 * @param statement - The human-readable statement (e.g., "total_goals_over:2.5:FRA-SPA")
 * @param merkleRoot - The anchored Merkle root (32 bytes)
 * @param outcome - 0=YES, 1=NO
 * @param validatorIxData - Complete validator instruction data (discriminator + args)
 */
export function buildResolveMarketIx(
  resolver: PublicKey,
  market: PublicKey,
  validatorProgram: PublicKey,
  validatorAccounts: PublicKey[],
  statement: string,
  merkleRoot: Uint8Array,
  outcome: number,
  validatorIxData: Buffer
): TransactionInstruction {
  // Anchor discriminator for resolve_market (from the IDL).
  // sha256("global:resolve_market")[0..8]
  const discriminator = Buffer.from([155, 23, 80, 173, 46, 74, 23, 239]);

  const statementBuf = Buffer.from(statement, "utf8");
  const merkleRootBuf = Buffer.from(merkleRoot);

  // Borsh String = 4 bytes length (LE) + UTF8 bytes
  const statementEncoded = Buffer.concat([
    encodeU32(statementBuf.length),
    statementBuf,
  ]);
  // Borsh Vec<u8> = 4 bytes length (LE) + bytes
  const validatorDataEncoded = Buffer.concat([
    encodeU32(validatorIxData.length),
    validatorIxData,
  ]);

  const data = Buffer.concat([
    discriminator,
    statementEncoded, // String
    merkleRootBuf, // [u8; 32]
    encodeU8(outcome), // u8
    validatorDataEncoded, // Vec<u8>
  ]);

  const keys = [
    { pubkey: resolver, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: deriveResolutionPda(market)[0], isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // remaining_accounts: validator program first, then its readonly accounts
    { pubkey: validatorProgram, isSigner: false, isWritable: false },
    ...validatorAccounts.map((acc) => ({
      pubkey: acc,
      isSigner: false,
      isWritable: false,
    })),
  ];

  return new TransactionInstruction({
    programId: new PublicKey(SETTLEMENT_PROGRAM_ID),
    data,
    keys,
  });
}

/**
 * Build the complete instruction data for TxLINE's validate_stat,
 * including the 8-byte discriminator. Use this with buildResolveMarketIx
 * when settling against the TxLINE oracle.
 *
 * @param params - The validate_stat parameters (same as before)
 * @returns Complete instruction data (discriminator + borsh args)
 */
export function buildTxlineValidateStatData(params: {
  ts: number;
  fixtureSummary: ScoresBatchSummary;
  fixtureProof: ProofNode[];
  mainTreeProof: ProofNode[];
  predicate: TraderPredicate;
  statA: StatTerm;
  statB?: StatTerm | null;
  op?: BinaryExpression | null;
}): Buffer {
  return Buffer.concat([
    TXLINE_VALIDATE_STAT_DISCRIMINATOR,
    buildValidateStatData(params),
  ]);
}

// ── Re-export types ─────────────────────────────────────────────────

export { Comparison, BinaryExpression };
export type { ScoreStat, ScoresBatchSummary, ProofNode, StatTerm, TraderPredicate };
