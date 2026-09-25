/**
 * Proof API route — fetches the TxLINE Merkle proof for a settled market.
 *
 * GET /api/proof/[market]
 *
 * Parses the settlement transaction's on-chain logs to extract the
 * MarketResolved event data (statement, merkle root, outcome, resolver,
 * timestamp, proof path). Returns it as JSON for client-side verification
 * via verifyProofLocally() from the SDK.
 *
 * This keeps chain interaction server-side. The client only needs to
 * call this endpoint and pass the result to the pure verification function.
 */

import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { SETTLEMENT_PROGRAM_ID } from "@stoppage/sdk";
import { devnetConnection } from "@/lib/rpc";

function connection() {
  return devnetConnection();
}

/**
 * Parse a MarketResolved event from settlement program logs.
 * The event data is base64-encoded in the program log line:
 *   "Program data: <base64>"
 *
 * Layout must match programs/settlement/src/lib.rs `MarketResolved`
 * (Anchor event: 8-byte discriminator, then fields in declaration order):
 *   8  discriminator = sha256("event:MarketResolved")[0..8]
 *   32 market (Pubkey)
 *   32 resolution (Pubkey)
 *   4  statement length (u32 LE) + statement (String)
 *   32 validator_program (Pubkey)
 *   32 merkle_root
 *   1  outcome (0=yes, 1=no, 2=void)
 *   32 proof_hash
 *   32 resolver (Pubkey)
 *   8  timestamp (i64 LE)
 *   1  validated_on_chain (bool)
 */
const MARKET_RESOLVED_DISCRIMINATOR = Buffer.from("5943e65f8f6ac7ca", "hex");

interface ParsedMarketResolved {
  market: string;
  resolution: string;
  statement: string;
  validatorProgram: string;
  merkleRoot: string;
  outcome: string;
  outcomeBool: number;
  proofHash: string;
  resolver: string;
  timestamp: number;
  validatedOnChain: boolean;
}

function parseMarketResolvedFromLogs(logs: string[]): ParsedMarketResolved | null {
  for (const log of logs) {
    if (!log.startsWith("Program data:")) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(log.replace("Program data:", "").trim(), "base64");
    } catch {
      continue;
    }
    if (buf.length < 8 + 32 + 32 + 4 || !buf.subarray(0, 8).equals(MARKET_RESOLVED_DISCRIMINATOR)) {
      continue;
    }
    try {
      let off = 8;
      const market = new PublicKey(buf.subarray(off, off + 32)).toBase58();
      off += 32;
      const resolution = new PublicKey(buf.subarray(off, off + 32)).toBase58();
      off += 32;
      const statementLen = buf.readUInt32LE(off);
      off += 4;
      if (buf.length < off + statementLen + 32 + 32 + 1 + 32 + 32 + 8 + 1) continue;
      const statement = Buffer.from(buf.subarray(off, off + statementLen)).toString("utf8");
      off += statementLen;
      const validatorProgram = new PublicKey(buf.subarray(off, off + 32)).toBase58();
      off += 32;
      const merkleRoot = Buffer.from(buf.subarray(off, off + 32)).toString("hex");
      off += 32;
      const outcomeBool = buf[off];
      off += 1;
      const outcome = outcomeBool === 0 ? "yes" : outcomeBool === 1 ? "no" : "void";
      const proofHash = Buffer.from(buf.subarray(off, off + 32)).toString("hex");
      off += 32;
      const resolver = new PublicKey(buf.subarray(off, off + 32)).toBase58();
      off += 32;
      const timestamp = Number(buf.readBigInt64LE(off));
      off += 8;
      const validatedOnChain = buf[off] !== 0;
      return {
        market,
        resolution,
        statement,
        validatorProgram,
        merkleRoot,
        outcome,
        outcomeBool,
        proofHash,
        resolver,
        timestamp,
        validatedOnChain,
      };
    } catch {
      // Not a valid event — skip.
    }
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const { market } = await params;

  try {
    const conn = connection();
    const marketPk = new PublicKey(market);

    // Find the settlement transaction by searching for the most recent
    // transaction involving this market account that contains a
    // MarketResolved event from the settlement program.
    const signatures = await conn.getSignaturesForAddress(marketPk, {
      limit: 20,
    });

    for (const sig of signatures) {
      if (sig.err) continue;
      try {
        const tx = await conn.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) continue;

        // Check if this transaction involves the settlement program
        const hasSettlement = tx.meta.logMessages.some((log) =>
          log.includes(SETTLEMENT_PROGRAM_ID)
        );
        if (!hasSettlement) continue;

        const resolved = parseMarketResolvedFromLogs(tx.meta.logMessages);
        if (resolved && resolved.market === market) {
          return Response.json({
            ok: true,
            marketId: market,
            signature: sig.signature,
            statement: resolved.statement,
            merkleRoot: resolved.merkleRoot,
            outcome: resolved.outcome,
            outcomeBool: resolved.outcomeBool,
            validatorProgram: resolved.validatorProgram,
            timestamp: resolved.timestamp,
            validatedOnChain: resolved.validatedOnChain,
            explorerUrl: `https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`,
          });
        }
      } catch {
        // Skip transactions we can't parse
        continue;
      }
    }

    // No settlement transaction found with parseable proof data
    return Response.json({
      ok: false,
      error: "No settlement proof found for this market",
      marketId: market,
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to fetch proof",
        marketId: market,
      },
      { status: 500 }
    );
  }
}