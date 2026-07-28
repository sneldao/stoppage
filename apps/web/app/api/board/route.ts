import { Connection, PublicKey } from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  MARKET_ACCOUNT_SIZE,
  LEGACY_MARKET_ACCOUNT_SIZE,
  parseMarket,
  upgradeLegacyMarketData,
  readU64LE,
  type Market,
} from "@stoppage/sdk";
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

/** The app's existing Helius devnet RPC, reused server-side as a more
 *  reliable fallback than the public gateway for getProgramAccounts scans. */
function heliusDevnetUrl() {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  return url && !url.includes("YOUR_API_KEY") ? url : null;
}

const RETRYABLE_RPC_ERROR = /429|too many requests|503|timed out|timeout|fetch failed|econnreset|socket hang up/i;

/** Retry transient RPC failures (public devnet rate-limits hard) with backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts - 1 || !RETRYABLE_RPC_ERROR.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}

async function readBoard(rpcUrl: string) {
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(MARKET_PROGRAM_ID);
  // Market accounts exist in two on-chain layouts: accounts created before
  // the oracle-agnostic pivot lack the 32-byte `oracle` field and keep the
  // smaller size after the program upgrade. dataSize filters are ANDed by
  // the RPC, so each layout needs its own scan (LEGACY_MARKET_ACCOUNT_SIZE).
  const [modernMarketAccounts, legacyMarketAccounts, positionAccounts] = await withRetry(() =>
    Promise.all([
      connection.getProgramAccounts(programId, { filters: [{ dataSize: MARKET_ACCOUNT_SIZE }], commitment: "confirmed" }),
      connection.getProgramAccounts(programId, { filters: [{ dataSize: LEGACY_MARKET_ACCOUNT_SIZE }], commitment: "confirmed" }),
      connection.getProgramAccounts(programId, { filters: [{ dataSize: POSITION_ACCOUNT_SIZE }], commitment: "confirmed" }),
    ])
  );

  const markets = new Map<string, Market>();
  let droppedAccounts = 0;
  for (const { pubkey, account } of [...modernMarketAccounts, ...legacyMarketAccounts]) {
    try {
      const data = account.data.length === LEGACY_MARKET_ACCOUNT_SIZE ? upgradeLegacyMarketData(account.data) : account.data;
      markets.set(pubkey.toBase58(), parseMarket(data, pubkey.toBase58()));
    } catch (error) {
      // Never drop an account silently (CLAUDE.md: partial data is worse
      // than loud failure) — count it and flag the response as degraded.
      droppedAccounts++;
      console.error("[board] failed to parse market account", pubkey.toBase58(), error);
    }
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
  return {
    playerCount: ranked.length,
    verifiedMarketCount: verifiedMarkets.length,
    totalAttestations: verifiedMarkets.reduce((total, market) => total + market.verifications, 0),
    entries: ranked,
    degraded: droppedAccounts > 0,
  };
}

/**
 * A public board derived directly from on-chain Market and Position accounts.
 * RPC candidates are tried in order: Shyft (when its free plan supports
 * getProgramAccounts), the app's Helius devnet RPC, then the bounded public
 * devnet gateway. Every candidate computes the full board; if we had to
 * fall back to a later candidate or drop unparseable accounts, the response
 * is flagged `degraded: true` instead of returning silent partial data.
 */
export async function GET() {
  const shyftUrl = shyftIndexAvailable !== false ? shyftDevnetUrl() : null;
  const candidates = [shyftUrl, heliusDevnetUrl(), PUBLIC_DEVNET_RPC].filter((url): url is string => Boolean(url));
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
