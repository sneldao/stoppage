/**
 * useHeliusMonitor — live on-chain event bridge into the store.
 *
 * Subscribes to the market program via HeliusMonitor and maps program
 * log events (MarketCreated, PositionOpened, MarketSettled, MarketVoided,
 * PositionClaimed) to store updates + a refresh of the affected accounts.
 * One subscription over polling (CLAUDE.md → Performance is a feature).
 */

import { useEffect, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { HeliusMonitor } from "@/lib/helius/monitor";
import { MARKET_PROGRAM_ID, getMarket } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";

const EVENT_MATCHERS = [
  "MarketCreated",
  "PositionOpened",
  "MarketSettled",
  "MarketVoided",
  "PositionClaimed",
];

/** Extract a base58 market address from a program log line, if present. */
function extractMarketAddress(log: string): string | null {
  const match = log.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return match ? match[0] : null;
}

export function useHeliusMonitor() {
  const { connection } = useConnection();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const upsertMarket = useStoppageStore((s) => s.upsertMarket);
  const setFeedState = useStoppageStore((s) => s.setFeedState);
  const monitorRef = useRef<HeliusMonitor | null>(null);

  useEffect(() => {
    // transactionSubscribe WebSockets only work on Helius (or similar enhanced
    // RPC). Public cluster endpoints (api.devnet.solana.com) reject them — fall
    // back to polling instead of spamming failed connections.
    const heliusUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
    const rpcUrl =
      heliusUrl && !heliusUrl.includes("YOUR_API_KEY") ? heliusUrl : undefined;

    if (!rpcUrl) {
      // No Helius URL configured — polling via useMarkets.refresh().
      setFeedState("polling");
      return;
    }

    const monitor = new HeliusMonitor({
      rpcUrl,
      accountInclude: [MARKET_PROGRAM_ID],
      eventMatchers: EVENT_MATCHERS,
      logLevel: "error",
      onEvent: (event) => {
        setFeedState("connected");
        // Push the affected market into the store immediately — no waiting
        // for the 12s poll. This is what makes settlement appear live.
        const addr = extractMarketAddress(event.log);
        if (addr) {
          void getMarket(connectionRef.current, new PublicKey(addr))
            .then((m) => upsertMarket(m))
            .catch(() => {});
        }
      },
    });

    monitorRef.current = monitor;
    try {
      monitor.connect();
      setFeedState("connected");
    } catch {
      setFeedState("polling");
    }

    return () => {
      monitor.disconnect();
      monitorRef.current = null;
      setFeedState("polling");
    };
    // Connection identity from wallet-adapter churns every render — read via ref.
  }, [upsertMarket, setFeedState]);
}
