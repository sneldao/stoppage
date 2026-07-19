/**
 * Pricing receipt API — fetches the on-chain pricing attestation for a market.
 *
 * GET /api/pricing-receipt/[market]
 *
 * Returns the live PricingReceipt account data: snapshot hash, model version,
 * fair value, bid/ask, agent signature, and timestamp. The client uses this
 * to render the verifiable reference line and the "Verify this price" panel.
 */

import { NextRequest } from "next/server";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { getPricingReceipt } from "@stoppage/sdk";

function connection() {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  return new Connection(
    url && !url.includes("YOUR_API_KEY") ? url : clusterApiUrl("devnet"),
    "confirmed"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const { market } = await params;

  try {
    const conn = connection();
    const marketPk = new PublicKey(market);
    const receipt = await getPricingReceipt(conn, marketPk);

    if (!receipt) {
      return Response.json(
        {
          ok: false,
          error: "No pricing receipt found for this market",
          marketId: market,
        },
        { status: 404 }
      );
    }

    return Response.json({
      ok: true,
      receipt,
      explorerUrl: `https://explorer.solana.com/address/${receipt.market}?cluster=devnet`,
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to fetch pricing receipt",
        marketId: market,
      },
      { status: 500 }
    );
  }
}
