"use client";

import Link from "next/link";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { formatSol as SOL } from "@/lib/format";

// SSR-safe wallet button — Phantom injects its icon on the client only,
// which causes a hydration mismatch if rendered during SSR.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-40" /> }
);

export default function Home() {
  const { state, delegate, ping, revoke, isSessionValid } = useSessionKey();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pingSig, setPingSig] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setError(null);
    try {
      const sig = await fn();
      if (label === "ping") setPingSig(sig);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-4 sm:p-8">
      <h1 className="text-4xl font-bold tracking-tight">Stoppage</h1>
      <p className="max-w-md text-center text-neutral-400">
        Markets that live inside the match, not around it. In-play
        micro-markets with one-tap session-key betting and verifiable
        settlement.
      </p>

      <WalletMultiButton />

      <Link
        href="/markets"
        className="rounded-lg border border-white/20 px-4 py-2 text-center text-sm hover:bg-white/5"
      >
        Browse markets →
      </Link>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          onClick={() => run("delegate", delegate)}
          disabled={busy !== null}
          className="rounded-lg bg-white px-4 py-2 font-medium text-black disabled:opacity-40"
        >
          {busy === "delegate" ? "Delegating…" : "Delegate session key (one popup)"}
        </button>

        <button
          onClick={() => run("ping", ping)}
          disabled={busy !== null || !isSessionValid()}
          className="rounded-lg border border-white/20 px-4 py-2 font-medium disabled:opacity-40"
        >
          {busy === "ping" ? "Pinging…" : "Ping with session key (no popup)"}
        </button>

        <button
          onClick={() => run("revoke", revoke)}
          disabled={busy !== null || !state.keypair}
          className="rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 disabled:opacity-40"
        >
          {busy === "revoke" ? "Revoking…" : "Revoke — stop betting for this match"}
        </button>
      </div>

      <div className="w-full max-w-sm text-sm">
        {state.delegated && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-emerald-400">
              Session key delegated. The ping button sends a tx signed by
              the session key alone — close your wallet extension and try
              it.
            </p>
            <div className="mt-2 text-xs text-neutral-500">
              <p>Funded: {SOL(100_000_000)} — the session key can only spend this</p>
              <p>Suggested limit: {SOL(100_000_000)} cumulative (opt-out available)</p>
              <p>Per-market cap: {SOL(50_000_000)}</p>
              <p>Session expires: auto at match end</p>
            </div>
          </div>
        )}
        {pingSig && (
          <p className="mt-2 break-all text-neutral-500">
            Ping landed: <code className="text-neutral-300">{pingSig}</code>
          </p>
        )}
        {error && <p className="mt-2 text-red-400">{error}</p>}
        {!state.delegated && !error && (
          <div className="text-neutral-600">
            <p>
              M1 flow: delegate once, then ping with the wallet closed.
              Market list and betting land in M2.
            </p>
            <p className="mt-2 text-xs">
              You set the boundaries: fund the session key with what
              you're willing to spend, optionally set a self-imposed cap,
              and one-tap self-exclude anytime. Your choice, your
              consequences.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
