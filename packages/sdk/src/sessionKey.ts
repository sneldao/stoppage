/**
 * Session-key delegation client — the M1 differentiator.
 *
 * Boundary (CLAUDE.md → Module boundaries): this module BUILDS instructions
 * and provides the session-key signer. It never imports the wallet adapter
 * and never calls wallet.signTransaction(). The web layer (useSessionKey
 * hook) orchestrates wallet signing for delegate/revoke; for session-key
 * signing it calls signWithSessionKey, which signs with the local keypair
 * only. If signWithSessionKey ever defers to the wallet, the differentiator
 * does not exist (rule 5).
 *
 * Instruction discriminators and account layouts are read from the IDL in
 * packages/sdk/idl/market.json — the single source of truth written by
 * scripts/deploy.sh (rule 2). No TypeScript mirror of the IDL is maintained.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import marketIdl from "../idl/market.json";

const MARKET_PROGRAM_ID = new PublicKey(marketIdl.address);
const SYSTEM_PROGRAM_ID = SystemProgram.programId;

/** PDA seed prefix for SessionGrant accounts — must match programs/market. */
const GRANT_SEED = Buffer.from("session_grant");

/** Discriminator lookup from the IDL — never hand-computed. */
function ixDiscriminator(name: string): Buffer {
  const ix = marketIdl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL missing instruction ${name} — run anchor build + copy IDL`);
  return Buffer.from(ix.discriminator);
}

// ── PDA derivation ──────────────────────────────────────────────────

/**
 * Derive the SessionGrant PDA for an (owner, sessionPubkey) pair.
 * Seeds: [b"session_grant", owner, sessionPubkey] — matches the program.
 */
export function findSessionGrantPda(
  owner: PublicKey,
  sessionPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GRANT_SEED, owner.toBuffer(), sessionPubkey.toBuffer()],
    MARKET_PROGRAM_ID
  );
}

// ── Borsh encoding for delegate_session_key args ───────────────────

function encodeVecPubkey(pubkeys: PublicKey[]): Buffer {
  const buf = Buffer.alloc(4 + pubkeys.length * 32);
  buf.writeUInt32LE(pubkeys.length, 0);
  pubkeys.forEach((pk, i) => pk.toBuffer().copy(buf, 4 + i * 32));
  return buf;
}

// Re-export the polyfill-safe u64/i64 writers from escrow.ts (rule 6 —
// one implementation). These avoid BigInt Buffer methods that browser
// polyfills omit.
import { writeU64LE, writeI64LE } from "./escrow";

function encodeU64(n: number): Buffer {
  return writeU64LE(BigInt(n));
}

function encodeI64(n: number): Buffer {
  return writeI64LE(BigInt(n));
}

// ── Instruction builders ───────────────────────────────────────────

export interface DelegateSessionKeyParams {
  owner: PublicKey;
  sessionPubkey: PublicKey;
  /** Programs the session key may invoke. Keep tight (market + settlement). */
  allowedPrograms: PublicKey[];
  /** Max lamports the session key may stake into a single market. */
  maxStakePerMarket: number;
  /** Optional self-imposed cumulative spend cap (rule 9). 0 = no cap
   *  (user's explicit choice). The real financial guardrail is
   *  fundLamports — the session key can only spend what it's been given. */
  maxTotalStake: number;
  /** Unix timestamp (seconds) after which the grant is invalid. */
  expiresAt: number;
  /** Lamports transferred from owner to the session key — covers both
   *  tx fees AND stake capital. Must be >= maxTotalStake + fee buffer. */
  fundLamports: number;
}

/**
 * Build the delegate_session_key instruction. The owner wallet signs this
 * once (via the wallet adapter in the web layer). This is the ONLY wallet
 * popup in the betting flow.
 */
export function buildDelegateSessionKeyIx(
  params: DelegateSessionKeyParams
): TransactionInstruction {
  const [grant] = findSessionGrantPda(params.owner, params.sessionPubkey);
  const data = Buffer.concat([
    ixDiscriminator("delegate_session_key"),
    encodeVecPubkey(params.allowedPrograms),
    encodeU64(params.maxStakePerMarket),
    encodeU64(params.maxTotalStake),
    encodeI64(params.expiresAt),
    encodeU64(params.fundLamports),
  ]);
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.sessionPubkey, isSigner: false, isWritable: true },
      { pubkey: grant, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the revoke_session_key instruction. Owner wallet signs (one more
 * popup — revocation is deliberately not frictionless). The grant account
 * is closed and rent refunded to the owner.
 */
export function buildRevokeSessionKeyIx(
  owner: PublicKey,
  sessionPubkey: PublicKey
): TransactionInstruction {
  const [grant] = findSessionGrantPda(owner, sessionPubkey);
  const data = ixDiscriminator("revoke_session_key");
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: sessionPubkey, isSigner: false, isWritable: false },
      { pubkey: grant, isSigner: false, isWritable: true },
    ],
    data,
  });
}

/**
 * Build the session_ping instruction. The session key signs this directly
 * (via signWithSessionKey) — the wallet is NOT involved. This is the M1
 * acceptance artifact and the grant-verification de-risk for M2.
 */
export function buildSessionPingIx(
  sessionPubkey: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  const [grant] = findSessionGrantPda(owner, sessionPubkey);
  const data = ixDiscriminator("session_ping");
  return new TransactionInstruction({
    programId: MARKET_PROGRAM_ID,
    keys: [
      { pubkey: sessionPubkey, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: grant, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Session-key signer (the differentiator) ───────────────────────

/**
 * Sign and send a transaction using ONLY the session keypair. The wallet
 * adapter is never called. This is what makes session-key delegation real
 * rather than decorative (CLAUDE.md rule 5).
 *
 * The session key is the fee payer and sole signer. Instructions passed in
 * are expected to require the session key as a signer (e.g. session_ping,
 * and later join/claim via session key).
 *
 * Returns the transaction signature.
 */
export async function signWithSessionKey(
  connection: Connection,
  sessionKeypair: Keypair,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: sessionKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(...instructions);
  tx.sign(sessionKeypair);
  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
}

export interface SessionTransactionResult {
  signature: string;
  signingMs: number;
  submittedAt: number;
  confirmedAt: number;
}

/**
 * Session-key transaction with measurable stages for the live execution UI.
 * The timestamps are captured at the client boundary, not inferred.
 */
export async function signAndConfirmWithSessionKey(
  connection: Connection,
  sessionKeypair: Keypair,
  instructions: TransactionInstruction[]
): Promise<SessionTransactionResult> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: sessionKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(...instructions);
  const signingStartedAt = performance.now();
  tx.sign(sessionKeypair);
  const signingMs = performance.now() - signingStartedAt;
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const submittedAt = Date.now();
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return { signature, signingMs, submittedAt, confirmedAt: Date.now() };
}
