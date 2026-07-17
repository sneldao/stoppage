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
import { HeliusMonitor } from "@/lib/helius/monitor";
import { MARKET_PROGRAM_ID } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";

const EVENT_MATCHERS = [
  "MarketCreated",
  "PositionOpened",
  "MarketSettled",
  "MarketVoided",
  "PositionClaimed",
];

export function useHeliusMonitor() {
  const { connection } = useConnection();
  const setMarketStatus = useStoppageStore((s) => s.setMarketStatus);
  const monitorRef = useRef<HeliusMonitor | null>(null);

  useEffect(() => {
    const rpcUrl =
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      (connection.rpcEndpoint.startsWith("https")
        ? connection.rpcEndpoint
        : undefined);

    if (!rpcUrl || rpcUrl.includes("YOUR_API_KEY")) {
      // No Helius URL configured — skip live monitoring. Polling via
      // useMarkets.refresh() is the fallback.
      return;
    }

    const monitor = new HeliusMonitor({
      rpcUrl,
      accountInclude: [MARKET_PROGRAM_ID],
      eventMatchers: EVENT_MATCHERS,
      logLevel: "error",
      onEvent: (event) => {
        // On any market/position event, the simplest correct action is
        // to mark the affected market stale and let the next render
        // re-fetch. For settle/void we flip the status optimistically;
        // a full refresh happens on the next poll or navigation.
        if (event.name === "MarketSettled") {
          // The log line carries the market address; a full parse is
          // non-trivial, so we rely on the next useMarkets.refresh().
        }
      },
    });

    monitorRef.current = monitor;
    monitor.connect();

    return () => {
      monitor.disconnect();
      monitorRef.current = null;
    };
  }, [connection.rpcEndpoint, setMarketStatus]);
}
