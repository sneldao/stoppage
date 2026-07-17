/**
 * Market vault client — create, join, claim, settle, void, attest.
 *
 * Boundary (CLAUDE.md → Module boundaries): this module builds
 * instructions and derives PDAs. It never imports the wallet adapter.
 * The web layer orchestrates wallet signing for create/claim_bond/
 * proof-gated settlement; join_via_session_key uses signWithSessionKey from
 * sessionKey.ts (no wallet popup).
 *
 * Instruction discriminators and account layouts are read from the IDL
 * in packages/sdk/idl/market.json (rule 2 — single source of truth).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import marketIdl from "../idl/market.json";
import type {
  Market,
  MarketPredicate,
  Position,
  ProtocolConfig,
  Side,
} from "./types";
import { PREDICATE_KIND, STATUS_FROM_NUM, OUTCOME_FROM_NUM } from "./types";
import { SETTLEMENT_PROGRAM_ID } from "./programIds";

const MARKET_PROGRAM_ID = new PublicKey(marketIdl.address);
const SYSTEM_PROGRAM_ID = SystemProgram.programId;

function ixDiscriminator(name: string): Buffer {
  const ix = marketIdl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL missing instruction ${name}`);
  return Buffer.from(ix.discriminator);
}

// ── PDA derivations ──────────────────────────────────────────────────

export function findProtocolConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    MARKET_PROGRAM_ID
  );
}

export function findTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    MARKET_PROGRAM_ID
  );
}

export function findMarketPda(
  kind: number,
  matchId: Buffer,
  team: Buffer,
  paramU64: bigint
): [PublicKey, number] {
  const paramLeBytes = writeU64LE(paramU64);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), matchId, Buffer.from([kind]), team, paramLeBytes],
    MARKET_PROGRAM_ID
  );
}

/**
 * Derive a market PDA from a MarketPredicate.
 * This is the high-level helper consumers should use — it handles
 * kind encoding, matchId/team padding, and param extraction.
 * The low-level `findMarketPda` is for cases where you already have
 * the raw buffers (e.g. parsing on-chain data).
 */
export function findMarketPdaFromPredicate(
  predicate: MarketPredicate
): [PublicKey, number] {
  const kind = PREDICATE_KIND[predicate.kind];
  const matchId = matchIdToBuffer(predicate.matchId);
  const team = teamToBuffer(String(predicate.params.team ?? ""));
  const paramU64 = BigInt(
    Number(
      predicate.params.windowSeconds ??
        predicate.params.threshold ??
        0
    )
  );
  return findMarketPda(kind, matchId, team, paramU64);
}

export function findPositionPda(
  market: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    MARKET_PROGRAM_ID
  );
}

// ── Encoding helpers ─────────────────────────────────────────────────
//
// Browser Buffer polyfills (e.g. the 'buffer' npm package) often omit
// BigInt methods (writeBigUInt64LE, readBigUInt64LE). We write/read
// 64-bit integers manually via DataView to stay polyfill-agnostic.

function encodeU8(n: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(n, 0);
  return buf;
}

function encodeU16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n, 0);
  return buf;
}

function encodeU64(n: number): Buffer {
  return writeU64LE(BigInt(n));
}

function encodeI64(n: number): Buffer {
  return writeI64LE(BigInt(n));
}

/** Write a u64 as little-endian bytes (polyfill-safe — no BigInt Buffer methods). */
export function writeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/** Write an i64 as little-endian bytes (polyfill-safe). */
export function writeI64LE(value: bigint): Buffer {
  // Two's complement for negatives, same byte layout as u64.
  return writeU64LE(BigInt.asUintN(64, value));
}

/** Read a u64 from little-endian bytes at offset (polyfill-safe). */
export function readU64LE(buf: Buffer, offset: number): bigint {
  let result = 0n;
  for (let i = 7; i >= 0; i--) {
    result = (result << 8n) | BigInt(buf[offset + i]);
  }
  return result;
}

/** Read an i64 from little-endian bytes at offset (polyfill-safe). */
export function readI64LE(buf: Buffer, offset: number): bigint {
  const u = readU64LE(buf, offset);
  return BigInt.asIntN(64, u);
}

/** Pad a string to a fixed-size buffer. */
function padString(s: string, len: number): Buffer {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, "utf8").copy(buf, 0, 0, Math.min(s.length, len));
  return buf;
}

/** Convert a match ID string to a 32-byte buffer. */
function matchIdToBuffer(matchId: string): Buffer {
  return padString(matchId, 32);
}

/** Convert a team code string to an 8-byte buffer. */
function teamToBuffer(team: string): Buffer {
  return padString(team, 8);
}

// ── Instruction builders ────────────────────────────────────────────

export function buildInitializeProtocolIx(
  authority: PublicKey,
  feeBps: number
): TransactionInstruction {
  const [config] = findProtocolConfigPda();
  const [treasury] = findTreasuryPda();
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixDiscriminator("initialize_protocol"), encodeU16(feeBps)]),
  });
}

export interface CreateMarketParams {
  creator: PublicKey;
  predicate: MarketPredicate;
  closesAt: number; // unix seconds
}

export function buildCreateMarketIx(
  params: CreateMarketParams
): TransactionInstruction {
  const kind = PREDICATE_KIND[params.predicate.kind];
  const matchId = matchIdToBuffer(params.predicate.matchId);
  const team = teamToBuffer(String(params.predicate.params.team ?? ""));
  const paramU64 = Number(
    params.predicate.params.windowSeconds ??
      params.predicate.params.threshold ??
      0
  );

  // Derive market PDA via the shared helper (rule 6 — one derivation).
  const [market] = findMarketPda(kind, matchId, team, BigInt(paramU64));

  const [config] = findProtocolConfigPda();

  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      ixDiscriminator("create_market"),
      encodeU8(kind),
      matchId,
      team,
      encodeU64(paramU64),
      encodeI64(params.closesAt),
    ]),
  });
}

export function buildJoinViaWalletIx(
  wallet: PublicKey,
  market: PublicKey,
  side: Side,
  amountLamports: number
): TransactionInstruction {
  const [position] = findPositionPda(market, wallet);
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      ixDiscriminator("join_via_wallet"),
      encodeU8(side === "yes" ? 0 : 1),
      encodeU64(amountLamports),
    ]),
  });
}

export function buildJoinViaSessionKeyIx(
  sessionKey: PublicKey,
  owner: PublicKey,
  market: PublicKey,
  side: Side,
  amountLamports: number
): TransactionInstruction {
  const [grant] = PublicKey.findProgramAddressSync(
    [Buffer.from("session_grant"), owner.toBuffer(), sessionKey.toBuffer()],
    MARKET_PROGRAM_ID
  );
  const [position] = findPositionPda(market, owner);
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: sessionKey, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: grant, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      ixDiscriminator("join_via_session_key"),
      encodeU8(side === "yes" ? 0 : 1),
      encodeU64(amountLamports),
    ]),
  });
}

export function buildSettleFromProofIx(
  resolver: PublicKey,
  market: PublicKey,
  outcome: Side
): TransactionInstruction {
  const [resolution] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolution"), market.toBuffer()],
    new PublicKey(SETTLEMENT_PROGRAM_ID)
  );
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: resolution, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      ixDiscriminator("settle_from_proof"),
      encodeU8(outcome === "yes" ? 0 : 1),
    ]),
  });
}

export function buildVoidMarketIx(
  caller: PublicKey,
  market: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
    ],
    data: ixDiscriminator("void_market"),
  });
}

export function buildClaimIx(
  claimant: PublicKey,
  market: PublicKey
): TransactionInstruction {
  const [position] = findPositionPda(market, claimant);
  const [treasury] = findTreasuryPda();
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: claimant, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
    ],
    data: ixDiscriminator("claim"),
  });
}

export function buildClaimBondIx(
  creator: PublicKey,
  market: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
    ],
    data: ixDiscriminator("claim_bond"),
  });
}

export function buildAttestVerificationIx(
  verifier: PublicKey,
  market: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: verifier, isSigner: true, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
    ],
    data: ixDiscriminator("attest_verification"),
  });
}

// ── Account parsing ─────────────────────────────────────────────────

/** Parse a raw account buffer into a Market object. */
export function parseMarket(accountData: Buffer, marketAddress: string): Market {
  // Skip 8-byte discriminator.
  let offset = 8;
  const kind = accountData.readUInt8(offset); offset += 1;
  const matchIdBuf = accountData.subarray(offset, offset + 32); offset += 32;
  const teamBuf = accountData.subarray(offset, offset + 8); offset += 8;
  const paramU64 = Number(readU64LE(accountData, offset)); offset += 8;
  const creator = new PublicKey(accountData.subarray(offset, offset + 32)).toString(); offset += 32;
  const bondLamports = Number(readU64LE(accountData, offset)); offset += 8;
  const bondClaimed = accountData.readUInt8(offset) !== 0; offset += 1;
  const yesPool = Number(readU64LE(accountData, offset)); offset += 8;
  const noPool = Number(readU64LE(accountData, offset)); offset += 8;
  const closesAt = Number(readI64LE(accountData, offset)); offset += 8;
  const settlesAt = Number(readI64LE(accountData, offset)); offset += 8;
  const status = accountData.readUInt8(offset); offset += 1;
  const outcome = accountData.readUInt8(offset); offset += 1;
  const feeBps = accountData.readUInt16LE(offset); offset += 2;
  const verifications = accountData.readUInt32LE(offset); offset += 4;

  const kindNames = ["next_goal_within", "corners_over", "card_shown", "total_goals_over"] as const;
  const matchId = matchIdBuf.toString("utf8").replace(/\0+$/, "");
  const team = teamBuf.toString("utf8").replace(/\0+$/, "");

  return {
    id: marketAddress,
    predicate: {
      kind: kindNames[kind] ?? "next_goal_within",
      matchId,
      params: { team, windowSeconds: paramU64 },
    },
    creator,
    bondLamports,
    bondClaimed,
    yesPool,
    noPool,
    closesAt: new Date(closesAt * 1000).toISOString(),
    settlesAt: settlesAt > 0 ? new Date(settlesAt * 1000).toISOString() : null,
    status: STATUS_FROM_NUM[status] ?? "open",
    outcome: OUTCOME_FROM_NUM[outcome] ?? "void",
    feeBps,
    verifications,
  };
}

/** Fetch and parse a Market account from chain. */
export async function getMarket(
  connection: Connection,
  marketAddress: PublicKey
): Promise<Market> {
  const accountInfo = await connection.getAccountInfo(marketAddress);
  if (!accountInfo || !accountInfo.data) {
    throw new Error(`Market account not found: ${marketAddress.toBase58()}`);
  }
  return parseMarket(accountInfo.data, marketAddress.toBase58());
}

/** Derive implied probability from vault balances. */
export function impliedProbability(market: Market): { yes: number; no: number } {
  const total = market.yesPool + market.noPool;
  if (total === 0) return { yes: 0.5, no: 0.5 };
  return { yes: market.yesPool / total, no: market.noPool / total };
}
