/**
 * Settled-market calibration — pairs on-chain outcomes with scored predictions.
 *
 * Primary p: on-chain PricingReceipt.fairValue (auditable, survives agent restarts).
 * Fallback p: latest agent quote when no receipt exists.
 * Void markets are excluded. No fabricated backtest numbers.
 */

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  MARKET_ACCOUNT_SIZE,
  parseMarket,
  getPricingReceipt,
  type Market,
} from "@stoppage/sdk";
import { backtest } from "@stoppage/quant";
import { formatMarketQuestion } from "@/lib/format";
import type { CalibrationPayload, PredictionSource, SettledCalibrationRow } from "@/lib/calibration/types";

export type { CalibrationPayload, PredictionSource, SettledCalibrationRow } from "@/lib/calibration/types";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";
const RECEIPT_FETCH_TIMEOUT_MS = 5000;
const AGENT_QUOTE_TIMEOUT_MS = 4000;
const OVERALL_TIMEOUT_MS = 9000;

function rpcConnection(): Connection {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  return new Connection(
    url && !url.includes("YOUR_API_KEY") ? url : clusterApiUrl("devnet"),
    "confirmed"
  );
}

/** Clamp a fair value to the valid [0,1] probability range. Non-finite → 0.5. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

async function fetchAllMarkets(connection: Connection): Promise<Market[]> {
  const programId = new PublicKey(MARKET_PROGRAM_ID);
  const resp = await connection.getProgramAccounts(programId, {
    filters: [{ dataSize: MARKET_ACCOUNT_SIZE }],
    commitment: "confirmed",
  });
  const markets: Market[] = [];
  for (const { pubkey, account } of resp) {
    try {
      markets.push(parseMarket(account.data, pubkey.toBase58()));
    } catch {
      // skip non-market accounts
    }
  }
  return markets;
}

async function fetchAgentQuote(
  marketId: string
): Promise<{ fairValue: number; modelVersion?: string } | null> {
  try {
    const resp = await fetch(
      `${AGENT_API_URL}/quotes?marketId=${encodeURIComponent(marketId)}`,
      { signal: AbortSignal.timeout(AGENT_QUOTE_TIMEOUT_MS), cache: "no-store" }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      latest?: { result?: { fairValue?: number; modelVersion?: string } };
    };
    const fairValue = data.latest?.result?.fairValue;
    if (fairValue == null || !Number.isFinite(fairValue)) return null;
    return {
      fairValue,
      modelVersion: data.latest?.result?.modelVersion,
    };
  } catch {
    return null;
  }
}

/** Race a promise against a timeout so one slow RPC can't stall the whole batch. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function resolvePrediction(
  connection: Connection,
  market: Market
): Promise<{ p: number; source: PredictionSource; modelVersion?: string } | null> {
  // Receipt first — auditable, survives agent restarts. Time-box the RPC
  // call so one hung account can't stall the batch.
  const receipt = await withTimeout(
    getPricingReceipt(connection, new PublicKey(market.id)),
    RECEIPT_FETCH_TIMEOUT_MS,
    null,
  ).catch(() => null);
  if (receipt) {
    return {
      p: clamp01(receipt.fairValue),
      source: "receipt",
      modelVersion: receipt.modelVersion,
    };
  }
  const agent = await fetchAgentQuote(market.id);
  if (agent) {
    return {
      p: clamp01(agent.fairValue),
      source: "agent_quote",
      modelVersion: agent.modelVersion,
    };
  }
  return null;
}

export async function buildCalibrationReport(): Promise<CalibrationPayload> {
  // Overall time-box so the route never exceeds a typical serverless budget.
  const result = await withTimeout(buildUncapped(), OVERALL_TIMEOUT_MS, null);
  if (result) return result;
  // Timed out — return an honest empty payload instead of a 502.
  return {
    report: { brier: 0, logLoss: 0, buckets: [], n: 0 },
    rows: [],
    settledCount: 0,
    scoredCount: 0,
    skippedNoQuote: 0,
  };
}

async function buildUncapped(): Promise<CalibrationPayload> {
  const connection = rpcConnection();
  const markets = await fetchAllMarkets(connection);
  const settled = markets.filter(
    (m) => m.status === "settled" && (m.outcome === "yes" || m.outcome === "no")
  );

  // Parallel receipt/quote fetches — one round-trip wall-clock instead of N.
  const predictions = await Promise.all(
    settled.map((market) => resolvePrediction(connection, market))
  );

  const rows: SettledCalibrationRow[] = [];
  let skippedNoQuote = 0;

  for (let i = 0; i < settled.length; i++) {
    const market = settled[i];
    const prediction = predictions[i];
    if (!prediction) {
      skippedNoQuote++;
      continue;
    }
    const outcomeYes = market.outcome === "yes";
    const o = outcomeYes ? 1 : 0;
    rows.push({
      marketId: market.id,
      label: formatMarketQuestion(market.predicate),
      predicted: prediction.p,
      outcome: market.outcome as "yes" | "no",
      source: prediction.source,
      modelVersion: prediction.modelVersion,
      brierContribution: (prediction.p - o) ** 2,
      verifications: market.verifications,
    });
  }

  rows.sort((a, b) => b.brierContribution - a.brierContribution);

  const report = backtest(
    rows.map((row) => ({
      p: row.predicted,
      outcome: row.outcome === "yes",
    }))
  );

  return {
    report,
    rows,
    settledCount: settled.length,
    scoredCount: rows.length,
    skippedNoQuote,
  };
}
