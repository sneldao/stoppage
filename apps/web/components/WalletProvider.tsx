"use client";

import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import {
  getPlatformWalletAdapter,
  isSolanaDappStore,
} from "@/lib/wallet/mobileAdapter";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const endpoint = useMemo(() => {
    const heliusUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
    if (heliusUrl && !heliusUrl.includes("YOUR_API_KEY")) {
      return heliusUrl;
    }
    return clusterApiUrl("devnet");
  }, []);

  const wallets = useMemo(() => {
    if (isSolanaDappStore()) {
      const mobileAdapter = getPlatformWalletAdapter({ cluster: "devnet" });
      if (mobileAdapter) {
        return [mobileAdapter];
      }
    }
    return [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
  }, []);

  const onError = (error: Error) => {
    // Multiple injected providers (MetaMask etc.) fight over window.ethereum;
    // log and continue rather than crashing the app shell.
    if (
      error.message.includes("ethereum") ||
      error.message.includes("provider") ||
      error.message.includes("detect-metamask")
    ) {
      console.warn("Provider conflict detected — continuing without wallet");
      return;
    }
    console.error("Wallet connection error:", error);
  };

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false} onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
