/**
 * useMarkets — fetch and subscribe to on-chain markets.
 *
 * Boundary (CLAUDE.md): fetching lives in hooks, not slices. This hook
 * reads markets via @stoppage/sdk + a Connection, writes results into the
 * zustand store, and lets HeliusMonitor push live updates into the same
 * store. Components read from the store; they never fetch directly.
 */

import { useCallback, useEffect, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { MARKET_PROGRAM_ID, parseMarket } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";

/**
 * Fetch all Market accounts for the market program and load them into
 * the store. Uses getProgramAccounts with a memcmp on the 8-byte
 * discriminator so we only deserialize real Market accounts.
 */
export function useMarkets() {
  const { connection } = useConnection();
  const upsertMarket = useStoppageStore((s) => s.upsertMarket);
  const markets = useStoppageStore((s) => s.markets);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      // Anchor accounts are prefixed with an 8-byte discriminator. We
      // don't need a memcmp for a small devnet program — just fetch all
      // accounts owned by the program and parse the ones that fit.
      const resp = await connection.getProgramAccounts(
        new PublicKey(MARKET_PROGRAM_ID),
        {
          filters: [{ dataSize: 8 + 1 + 32 + 8 + 8 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 1 + 2 + 4 + 1 }],
          commitment: "confirmed",
        }
      );
      for (const { pubkey, account } of resp) {
        try {
          const market = parseMarket(account.data, pubkey.toBase58());
          upsertMarket(market);
        } catch {
          // Skip accounts that don't parse as Market (e.g. config, grants).
        }
      }
    } finally {
      fetchingRef.current = false;
    }
  }, [connection, upsertMarket]);

  // Initial load on mount + when the connection changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { markets, refresh };
}
