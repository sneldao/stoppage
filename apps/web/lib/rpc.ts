import { Connection, clusterApiUrl } from "@solana/web3.js";

/**
 * Devnet RPC resolution — one place for the provider fallback chain
 * (CLAUDE.md: one source of truth). Helius is the primary provider
 * (NEXT_PUBLIC_HELIUS_RPC_URL); Alchemy is the sponsored fallback
 * (NEXT_PUBLIC_ALCHEMY_RPC_URL). Placeholder URLs ("YOUR_API_KEY") are
 * treated as unset so committed examples never win over the public
 * gateway.
 */

function usable(url: string | undefined): url is string {
  return Boolean(url) && !url!.includes("YOUR_API_KEY");
}

/** Preferred devnet RPC URLs in order; empty when none configured. */
export function devnetRpcUrls(): string[] {
  return [
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL,
    process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL,
  ].filter(usable);
}

/** Connection to the best configured devnet RPC, else the public gateway. */
export function devnetConnection(): Connection {
  return new Connection(devnetRpcUrls()[0] ?? clusterApiUrl("devnet"), "confirmed");
}
