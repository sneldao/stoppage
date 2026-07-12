"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Stoppage</h1>
      <p className="max-w-md text-center text-neutral-400">
        Markets that live inside the match, not around it. In-play
        micro-markets with one-tap session-key betting and verifiable
        settlement.
      </p>
      <WalletMultiButton />
      <p className="text-sm text-neutral-600">
        Scaffold state — market list and session-key flow land next.
      </p>
    </main>
  );
}
