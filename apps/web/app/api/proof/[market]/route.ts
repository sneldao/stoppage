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
import {
  clusterApiUrl,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { SETTLEMENT_PROGRAM_ID } from "@stoppage/sdk";

function connection() {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  return new Connection(
    url && !url.includes("YOUR_API_KEY") ? url : clusterApiUrl("devnet"),
    "confirmed"
  );
}

/**
 * Parse a MarketResolved event from settlement program logs.
 * The event data is base64-encoded in the program log line:
 *   "Program data: <base64>"
 */
function parseMarketResolvedFromLogs(logs: string[]): {
  statement: string;
  merkleRoot: string;
  outcome: string;
  outcomeBool: number;
  timestamp: number;
} | null {
  // Look for the MarketResolved discriminator in program data lines
  for (const log of logs) {
    if (log.includes("Program data:")) {
      const b64 = log.replace("Program data:", "").trim();
      try {
        const buf = Buffer.from(b64, "base64");
        // The MarketResolved event layout (Anchor):
        //   8 bytes discriminator
        //   32 bytes statement (public key / market address)
        //   32 bytes merkle root
        //   1 byte outcome (0=yes, 1=no, 2=void)
        //   8 bytes timestamp (i64 LE)
        if (buf.length >= 81) {
          const statement = new PublicKey(buf.subarray(8, 40)).toBase58();
          const merkleRoot = buf.subarray(40, 72).toString("hex");
          const outcomeBool = buf[72];
          const outcome = outcomeBool === 0 ? "yes" : outcomeBool === 1 ? "no" : "void";
          const timestamp = buf.readBigInt64LE(73);
          return { statement, merkleRoot, outcome, outcomeBool, timestamp: Number(timestamp) };
        }
      } catch {
        // Not a valid base64 or wrong format — skip
      }
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
        if (resolved) {
          return Response.json({
            ok: true,
            marketId: market,
            signature: sig.signature,
            statement: resolved.statement,
            merkleRoot: resolved.merkleRoot,
            outcome: resolved.outcome,
            outcomeBool: resolved.outcomeBool,
            timestamp: resolved.timestamp,
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