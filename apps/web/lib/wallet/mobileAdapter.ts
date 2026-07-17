/**
 * Solana Mobile Wallet Adapter integration (dApp Store / Seed Vault).
 * Ported from pir8 src/lib/mobile/walletAdapter.ts, rebranded.
 */

import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";

type Cluster = "devnet" | "testnet" | "mainnet-beta";

export const APP_IDENTITY = {
  name: "Stoppage",
  // Production: set NEXT_PUBLIC_APP_URL to your deployed URL.
  // Development: fallback to localhost so the mobile adapter works locally.
  uri: process.env["NEXT_PUBLIC_APP_URL"] || "http://localhost:3000",
  icon: "/icon-192x192.png",
} as const;

export interface MobileWalletAdapterConfig {
  cluster?: Cluster;
  identity?: typeof APP_IDENTITY;
}

export function createMobileWalletAdapter(
  config: MobileWalletAdapterConfig = {}
) {
  const { cluster = "devnet", identity = APP_IDENTITY } = config;

  return new SolanaMobileWalletAdapter({
    appIdentity: identity,
    cluster,
    addressSelector: createDefaultAddressSelector(),
    authorizationResultCache: createDefaultAuthorizationResultCache(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
}

/** Detect the Solana dApp Store / Seed Vault environment (Android). */
export function isSolanaDappStore(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // @ts-ignore - Android-specific injected properties
  const hasSeedVault =
    typeof window.solana !== "undefined" &&
    // @ts-ignore
    window.solana.isSeedVault;

  // @ts-ignore
  const hasMWA =
    typeof navigator !== "undefined" &&
    // @ts-ignore
    navigator.solana?.isMobileWalletAdapter;

  return Boolean(hasSeedVault || hasMWA);
}

export function getPlatformWalletAdapter(
  config: MobileWalletAdapterConfig = {}
) {
  if (isSolanaDappStore()) {
    return createMobileWalletAdapter(config);
  }
  return null;
}
