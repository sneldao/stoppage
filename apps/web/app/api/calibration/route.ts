import { NextResponse } from "next/server";
import { buildCalibrationReport } from "@/lib/calibration/buildCalibrationReport";

// Server-only route: imports @solana/web3.js via buildCalibrationReport.
// Match the explicit runtime/dynamic declarations used by the other
// RPC-backed routes (board, proof, pricing-receipt).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/calibration — settled-market Brier score + reliability buckets.
 *
 * Scores each settled yes/no market against its on-chain PricingReceipt fair
 * value, falling back to the agent's latest quote when no receipt exists.
 */
export async function GET() {
  try {
    const payload = await buildCalibrationReport();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Calibration unavailable" },
      { status: 502 }
    );
  }
}
