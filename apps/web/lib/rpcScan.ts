import { Connection, PublicKey } from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  MARKET_ACCOUNT_SIZE,
  LEGACY_MARKET_ACCOUNT_SIZE,
  parseMarket,
  upgradeLegacyMarketData,
  type Market,
} from "@stoppage/sdk";
import { devnetRpcUrls } from "@/lib/rpc";

/**
 * Shared on-chain market scanning for server routes (board, receipts).
 * Market accounts exist in two layouts (pre-oracle-pivot legacy accounts
 * are 32 bytes smaller); dataSize filters are ANDed by the RPC, so each
 * layout needs its own scan. Unparseable accounts are counted, never
 * dropped silently — responses carry `degraded` instead of partial lies.
 */

const RETRYABLE_RPC_ERROR = /429|too many requests|503|timed out|timeout|fetch failed|econnreset|socket hang up/i;

/** Retry transient RPC failures (public devnet rate-limits hard) with backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
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

export interface MarketScan {
  markets: Map<string, Market>;
  droppedAccounts: number;
}

export async function scanMarketAccounts(connection: Connection): Promise<MarketScan> {
  const programId = new PublicKey(MARKET_PROGRAM_ID);
  const [modernMarketAccounts, legacyMarketAccounts] = await withRetry(() =>
    Promise.all([
      connection.getProgramAccounts(programId, { filters: [{ dataSize: MARKET_ACCOUNT_SIZE }], commitment: "confirmed" }),
      connection.getProgramAccounts(programId, { filters: [{ dataSize: LEGACY_MARKET_ACCOUNT_SIZE }], commitment: "confirmed" }),
    ])
  );
  const markets = new Map<string, Market>();
  let droppedAccounts = 0;
  for (const { pubkey, account } of [...modernMarketAccounts, ...legacyMarketAccounts]) {
    try {
      const data = account.data.length === LEGACY_MARKET_ACCOUNT_SIZE ? upgradeLegacyMarketData(account.data) : account.data;
      markets.set(pubkey.toBase58(), parseMarket(data, pubkey.toBase58()));
    } catch (error) {
      console.error("[scan] failed to parse market account", pubkey.toBase58(), error);
      droppedAccounts++;
    }
  }
  return { markets, droppedAccounts };
}

/**
 * Try each candidate RPC (configured devnet providers, then the public
 * gateway) until one yields a full read. `fellBack` marks responses served
 * by a later candidate so callers can flag degraded data loudly.
 */
export async function withRpcCandidates<T>(
  read: (connection: Connection) => Promise<T>
): Promise<{ value: T | null; fellBack: boolean; lastError: string | null }> {
  const publicDevnet = "https://api.devnet.solana.com";
  const candidates = [...devnetRpcUrls(), publicDevnet];
  let fellBack = false;
  let lastError: string | null = null;
  for (const url of candidates) {
    try {
      const value = await read(new Connection(url, "confirmed"));
      return { value, fellBack, lastError };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      fellBack = true;
      console.error("[scan] RPC candidate failed:", url.split("?")[0], lastError);
    }
  }
  return { value: null, fellBack, lastError };
}
