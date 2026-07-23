import { Connection, PublicKey } from "@solana/web3.js";
import { MARKET_PROGRAM_ID, MARKET_ACCOUNT_SIZE, parseMarket, readU64LE, type Market } from "@stoppage/sdk";
import { NextResponse } from "next/server";

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
  const [marketAccounts, positionAccounts] = await Promise.all([
    connection.getProgramAccounts(programId, { filters: [{ dataSize: MARKET_ACCOUNT_SIZE }], commitment: "confirmed" }),
    connection.getProgramAccounts(programId, { filters: [{ dataSize: POSITION_ACCOUNT_SIZE }], commitment: "confirmed" }),
  ]);

  const markets = new Map<string, Market>();
  for (const { pubkey, account } of marketAccounts) {
    try { markets.set(pubkey.toBase58(), parseMarket(account.data, pubkey.toBase58())); } catch {}
  }

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
  return { playerCount: ranked.length, verifiedMarketCount: verifiedMarkets.length, totalAttestations: verifiedMarkets.reduce((total, market) => total + market.verifications, 0), entries: ranked };
}

/**
 * A public board derived directly from on-chain Market and Position accounts.
 * Shyft's free key is validated and used when its plan supports index RPCs;
 * public devnet is the bounded fallback for the current free plan.
 */
export async function GET() {
  try {
    const shyftUrl = shyftDevnetUrl();
    if (shyftUrl && shyftIndexAvailable !== false) {
      try {
        const board = await readBoard(shyftUrl);
        shyftIndexAvailable = true;
        return NextResponse.json(board, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
      } catch {
        shyftIndexAvailable = false;
      }
    }
    const board = await readBoard(PUBLIC_DEVNET_RPC);
    return NextResponse.json(board, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Public board unavailable" }, { status: 502 });
  }
}
