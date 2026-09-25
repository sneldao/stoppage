import { Connection } from "@solana/web3.js";
import type { Market } from "@stoppage/sdk";
import { NextResponse } from "next/server";
import { scanMarketAccounts, withRpcCandidates } from "@/lib/rpcScan";
import { formatMarketQuestion } from "@/lib/format";
import type { MatchEvent } from "@stoppage/sdk";

/**
 * The cumulative Settled Week track record — chain-derived, ledger-enriched.
 *
 * Every proof-gated settlement on the market program (sports via TxLINE,
 * price via Pyth, custom-oracle attestations) is a settled Market account;
 * that is the permanent public record. The keeper's match-events ledger is
 * queried only to annotate (the settlement tx signature), never as the
 * source of truth — if the agent is unreachable the receipts still render.
 */

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:18766";

interface ReceiptRow {
  marketId: string;
  question: string;
  kind: string;
  matchId: string;
  outcome: string | null;
  oracle: string | null;
  settlesAt: string | null;
  closesAt: string;
  verifications: number;
  yesPool: number;
  noPool: number;
  settleSignature: string | null;
  /** True for the weekly SOL/USD window markets (`SOL/USD:W2026-39`). */
  week: boolean;
}

/** Newest-first settled markets, week window markets flagged. */
function toReceipt(market: Market, signatures: Map<string, string>): ReceiptRow {
  return {
    marketId: market.id,
    question: formatMarketQuestion(market.predicate),
    kind: market.predicate.kind,
    matchId: market.predicate.matchId,
    outcome: market.outcome,
    oracle: market.oracle,
    settlesAt: market.settlesAt,
    closesAt: market.closesAt,
    verifications: market.verifications,
    yesPool: market.yesPool,
    noPool: market.noPool,
    settleSignature: signatures.get(market.id) ?? null,
    week: /:W\d{4}-\d{2}$/.test(market.predicate.matchId),
  };
}

/** Best-effort settle-tx annotations from the keeper ledger. */
async function settlementSignatures(): Promise<Map<string, string>> {
  const signatures = new Map<string, string>();
  try {
    const resp = await fetch(`${AGENT_API_URL}/events`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return signatures;
    const data = (await resp.json()) as { events?: MatchEvent[] };
    for (const event of data.events ?? []) {
      if (event.kind === "settlement_confirmed" && event.marketId && event.signature && !signatures.has(event.marketId)) {
        signatures.set(event.marketId, event.signature);
      }
    }
  } catch {
    // Agent unreachable / stale — receipts still render from the chain.
  }
  return signatures;
}

/** 30-minute interval SOL/USD settlements (unix-ref matchIds) settle dozens
 *  a day — high-frequency utility traffic, not a track record. They count in
 *  the totals but are not listed row-by-row; the list covers sports,
 *  attested, and weekly window settles. */
const INTERVAL_MATCH_REF = /^\S+:\d{10}$/;

export async function GET() {
  const signatures = await settlementSignatures();
  const { value, fellBack } = await withRpcCandidates(async (connection: Connection) => {
    const { markets, droppedAccounts } = await scanMarketAccounts(connection);
    const settledAll = [...markets.values()].filter((market) => market.status === "settled");
    const settled = settledAll
      .filter((market) => !INTERVAL_MATCH_REF.test(market.predicate.matchId))
      .sort((a, b) => (b.settlesAt ?? "").localeCompare(a.settlesAt ?? ""))
      .slice(0, 60)
      .map((market) => toReceipt(market, signatures));
    const weekCount = settledAll.filter((market) =>
      /:W\d{4}-\d{2}$/.test(market.predicate.matchId)
    ).length;
    return {
      settled,
      droppedAccounts,
      settledTotal: settledAll.length,
      verifiedTotal: settledAll.filter((market) => market.verifications > 0).length,
      weekCount,
    };
  });

  if (!value) {
    return NextResponse.json({ error: "Receipt scan unavailable", degraded: true }, { status: 502 });
  }
  return NextResponse.json(
    {
      receipts: value.settled,
      stats: {
        settledTotal: value.settledTotal,
        verifiedCount: value.verifiedTotal,
        weekCount: value.weekCount,
      },
      degraded: fellBack || value.droppedAccounts > 0,
    },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } }
  );
}
