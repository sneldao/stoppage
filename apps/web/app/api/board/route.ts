import { Connection, PublicKey } from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  readU64LE,
} from "@stoppage/sdk";
import { NextResponse } from "next/server";
import { devnetRpcUrls } from "@/lib/rpc";
import { scanMarketAccounts, withRetry } from "@/lib/rpcScan";

const POSITION_ACCOUNT_SIZE = 8 + 32 + 32 + 1 + 8 + 1 + 1;
const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
let shyftIndexAvailable: boolean | null = null;

interface BoardEntry {
  owner: string;
  marketsPlayed: number;
  resolved: number;
  correct: number;
  accuracy: number;
  volumeLamports: number;
  proofMarketIds: string[];
}

interface PositionRecord {
  marketId: string;
  owner: string;
  side: "yes" | "no";
  amountLamports: number;
}

function shyftDevnetUrl() {
  const key = process.env.SHYFT_API_KEY;
  return key ? `https://devnet-rpc.shyft.to/?api_key=${encodeURIComponent(key)}` : null;
}

async function readBoard(rpcUrl: string) {
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(MARKET_PROGRAM_ID);
  // Two market layouts (legacy + modern) + positions; the market scan is
  // shared with /api/receipts (lib/rpcScan). Positions are scanned here so
  // the whole read retries as one atomic snapshot attempt.
  const [{ markets, droppedAccounts: droppedMarketAccounts }, positionAccounts] = await withRetry(async () => {
    const scanned = await scanMarketAccounts(connection);
    const positions = await connection.getProgramAccounts(programId, {
      filters: [{ dataSize: POSITION_ACCOUNT_SIZE }],
      commitment: "confirmed",
    });
    return [scanned, positions] as const;
  });

  const positions: PositionRecord[] = [];
  const sideCounts = new Map<string, { yes: number; no: number }>();
  for (const { account } of positionAccounts) {
    const data = account.data;
    let offset = 8;
    const marketId = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const owner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const side = data.readUInt8(offset) === 0 ? "yes" : "no";
    offset += 1;
    const amountLamports = Number(readU64LE(data, offset));
    positions.push({ marketId, owner, side, amountLamports });
    const counts = sideCounts.get(marketId) ?? { yes: 0, no: 0 };
    counts[side]++;
    sideCounts.set(marketId, counts);
  }

  const entries = new Map<string, BoardEntry>();
  for (const { marketId, owner, side, amountLamports } of positions) {
    const market = markets.get(marketId);
    if (!market || (market.status !== "settled" && market.status !== "void")) continue;
    const sidePool = side === "yes" ? market.yesPool : market.noPool;
    const sideCount = Math.max(sideCounts.get(marketId)?.[side] ?? 1, 1);
    const countedLamports = amountLamports > 0
      ? amountLamports
      : market.status === "settled" && side === market.outcome
        ? Math.floor(sidePool / sideCount)
        : 0;

    const entry = entries.get(owner) ?? { owner, marketsPlayed: 0, resolved: 0, correct: 0, accuracy: 0, volumeLamports: 0, proofMarketIds: [] };
    entry.marketsPlayed++;
    entry.volumeLamports += countedLamports;
    if (market.status === "settled") {
      entry.resolved++;
      if (side === market.outcome) entry.correct++;
    }
    if (market.verifications > 0 && !entry.proofMarketIds.includes(marketId)) entry.proofMarketIds.push(marketId);
    entries.set(owner, entry);
  }

  const ranked = [...entries.values()]
    .filter((entry) => entry.resolved > 0)
    .map((entry) => ({ ...entry, accuracy: entry.correct / entry.resolved }))
    .sort((a, b) => b.accuracy - a.accuracy || b.volumeLamports - a.volumeLamports || b.resolved - a.resolved)
    .slice(0, 20);
  const verifiedMarkets = [...markets.values()].filter((market) => market.status === "settled" && market.verifications > 0);
  return {
    playerCount: ranked.length,
    verifiedMarketCount: verifiedMarkets.length,
    totalAttestations: verifiedMarkets.reduce((total, market) => total + market.verifications, 0),
    entries: ranked,
    degraded: droppedMarketAccounts > 0,
  };
}

/**
 * A public board derived directly from on-chain Market and Position accounts.
 * RPC candidates are tried in order: Shyft (when its free plan supports
 * getProgramAccounts), the app's configured devnet RPCs (Helius, then
 * Alchemy — lib/rpc.ts), then the bounded public devnet gateway. Every candidate computes the full board; if we had to
 * fall back to a later candidate or drop unparseable accounts, the response
 * is flagged `degraded: true` instead of returning silent partial data.
 */
export async function GET() {
  const shyftUrl = shyftIndexAvailable !== false ? shyftDevnetUrl() : null;
  const candidates = [shyftUrl, ...devnetRpcUrls(), PUBLIC_DEVNET_RPC].filter((url): url is string => Boolean(url));
  let fellBack = false;
  for (const url of candidates) {
    try {
      const board = await readBoard(url);
      if (url === shyftUrl) shyftIndexAvailable = true;
      return NextResponse.json(
        { ...board, degraded: board.degraded || fellBack },
        { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } }
      );
    } catch (error) {
      if (url === shyftUrl) shyftIndexAvailable = false;
      fellBack = true;
      // Mask the query string so API keys never hit logs.
      console.error("[board] RPC candidate failed:", url.split("?")[0], error instanceof Error ? error.message : error);
    }
  }
  return NextResponse.json({ error: "Public board unavailable", degraded: true }, { status: 502 });
}
