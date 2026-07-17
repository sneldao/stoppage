"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  getMarket,
  impliedProbability,
  PREDICATE_LABEL,
  type Market,
  type Side,
} from "@stoppage/sdk";
import { useMarketActions } from "@/lib/markets/useMarketActions";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { ShareBar } from "@/components/ShareBar";
import { ProofPanel } from "@/components/ProofPanel";
import { formatSol as SOL, LAMPORTS_PER_SOL } from "@/lib/format";

export default function MarketDetailPage() {
  const params = useParams<{ market: string }>();
  const marketAddr = params.market;
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { state, getSessionSigner } = useSessionKey();
  const { joinViaWallet, joinViaSessionKey, claim } = useMarketActions();
  useMyPositions();

  const storeMarket = useStoppageStore((s) => s.markets[marketAddr]);
  const myPosition = useStoppageStore((s) =>
    publicKey ? s.positions[`${marketAddr}:${publicKey.toBase58()}`] : undefined
  );

  const [liveMarket, setLiveMarket] = useState<Market | null>(storeMarket ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountSol, setAmountSol] = useState("0.05");

  // Fetch the market on mount / when connection is ready, if not in store.
  useEffect(() => {
    if (storeMarket) {
      setLiveMarket(storeMarket);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const m = await getMarket(connection, new PublicKey(marketAddr));
        if (!cancelled) setLiveMarket(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, marketAddr, storeMarket]);

  const market = liveMarket ?? storeMarket ?? null;
  const odds = market ? impliedProbability(market) : { yes: 0.5, no: 0.5 };
  const amountLamports = Math.round(parseFloat(amountSol || "0") * LAMPORTS_PER_SOL);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      // Re-fetch the market + position after any state-changing action.
      try {
        const m = await getMarket(connection, new PublicKey(marketAddr));
        setLiveMarket(m);
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onJoin = (side: Side) => {
    if (!publicKey) {
      setError("Connect your wallet first");
      return;
    }
    if (amountLamports <= 0) {
      setError("Enter a stake amount");
      return;
    }
    const signer = getSessionSigner();
    if (signer && state.delegated) {
      // No-popup path — the differentiator.
      void run(`join-${side}-session`, () =>
        joinViaSessionKey(signer, publicKey, {
          market: new PublicKey(marketAddr),
          side,
          amountLamports,
        })
      );
    } else {
      void run(`join-${side}-wallet`, () =>
        joinViaWallet({
          market: new PublicKey(marketAddr),
          side,
          amountLamports,
        })
      );
    }
  };

  const onClaim = () => {
    void run("claim", () => claim(new PublicKey(marketAddr)));
  };

  if (!market) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8">
        <p className="text-neutral-400">Loading market…</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Link href="/markets" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← back to markets
        </Link>
      </main>
    );
  }

  const canJoin = market.status === "open";
  const canClaim =
    (market.status === "settled" || market.status === "void") &&
    myPosition &&
    myPosition.amountLamports > 0;
  const isWinner =
    market.status === "settled" &&
    myPosition &&
    myPosition.side === market.outcome;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <Link href="/markets" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← markets
      </Link>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
        <h1 className="text-lg font-bold sm:text-xl">
          {PREDICATE_LABEL[market.predicate.kind] ?? market.predicate.kind}{" "}
          {market.predicate.params.windowSeconds ?? market.predicate.params.threshold ?? ""}
          {market.predicate.params.team ? ` · ${market.predicate.params.team}` : ""}
        </h1>
        <p className="mt-1 text-xs text-neutral-500 sm:text-sm">
          match {market.predicate.matchId} · closes {new Date(market.closesAt).toLocaleString()}
        </p>

        {/* ── Visual odds bar ── */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="text-emerald-400">YES {(odds.yes * 100).toFixed(0)}%</span>
            <span className="text-red-400">NO {(odds.no * 100).toFixed(0)}%</span>
          </div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="bg-emerald-500 transition-all duration-500"
              style={{ width: `${odds.yes * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${odds.no * 100}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm sm:gap-3">
          <div className="rounded-lg border border-white/10 p-2 sm:p-3">
            <p className="text-xs text-neutral-500">YES pool</p>
            <p className="text-emerald-400">{SOL(market.yesPool)}</p>
          </div>
          <div className="rounded-lg border border-white/10 p-2 sm:p-3">
            <p className="text-xs text-neutral-500">NO pool</p>
            <p className="text-red-400">{SOL(market.noPool)}</p>
          </div>
          <div className="rounded-lg border border-white/10 p-2 sm:p-3">
            <p className="text-xs text-neutral-500">Status</p>
            <p className="capitalize">{market.status.replace("_", " ")}</p>
            <p className="text-xs text-neutral-600">fee {market.feeBps / 100}%</p>
          </div>
        </div>
      </div>

      {/* ── Share bar (viral: tweet, Blink URL, referral) ── */}
      {canJoin && (
        <ShareBar
          market={market}
          pageUrl={
            typeof window !== "undefined"
              ? `${window.location.origin}/markets/${marketAddr}`
              : `/markets/${marketAddr}`
          }
        />
      )}

      {/* ── Join panel ── */}
      {canJoin && (
        <div className="rounded-xl border border-white/10 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Place a bet</h2>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min="0.001"
                step="0.01"
                value={amountSol}
                onChange={(e) => setAmountSol(e.target.value)}
                className="w-24 rounded border border-white/20 bg-transparent px-2 py-1 text-right"
              />
              <span className="text-neutral-500">SOL</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => onJoin("yes")}
              disabled={busy !== null}
              className="rounded-lg bg-emerald-500/90 px-4 py-3 font-medium text-black disabled:opacity-40"
            >
              {busy === "join-yes-session" ? "Signing with session key…"
                : busy === "join-yes-wallet" ? "Sign in wallet…"
                : "Back YES"}
            </button>
            <button
              onClick={() => onJoin("no")}
              disabled={busy !== null}
              className="rounded-lg bg-red-500/90 px-4 py-3 font-medium text-black disabled:opacity-40"
            >
              {busy === "join-no-session" ? "Signing with session key…"
                : busy === "join-no-wallet" ? "Sign in wallet…"
                : "Back NO"}
            </button>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            {state.delegated
              ? "Session key active — bets sign with no wallet popup (the differentiator). Close your wallet extension and try it."
              : "No session key delegated — each bet pops the wallet. Delegate from the home page for no-popup betting."}
          </p>
        </div>
      )}

      {/* ── My position ── */}
      {myPosition && (
        <div className="rounded-xl border border-white/10 p-6">
          <h2 className="font-medium">Your position</h2>
          <div className="mt-3 flex items-center gap-4 text-sm">
            <span className={myPosition.side === "yes" ? "text-emerald-400" : "text-red-400"}>
              {myPosition.side.toUpperCase()} · {SOL(myPosition.amountLamports)}
            </span>
            {myPosition.openedViaSessionKey && (
              <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-xs text-emerald-400">
                via session key
              </span>
            )}
          </div>

          {market.status === "settled" && (
            <p className={`mt-3 text-sm ${isWinner ? "text-emerald-400" : "text-neutral-500"}`}>
              {isWinner ? "You won — claim your payout." : "You lost — nothing to claim."}
            </p>
          )}
          {market.status === "void" && (
            <p className="mt-3 text-sm text-amber-400">Market voided — claim a full refund.</p>
          )}

          {canClaim && (
            <button
              onClick={onClaim}
              disabled={busy !== null}
              className="mt-4 rounded-lg bg-white px-4 py-2 font-medium text-black disabled:opacity-40"
            >
              {busy === "claim" ? "Claiming…" : "Claim"}
            </button>
          )}
        </div>
      )}

      {/* ── Verifiable Resolution panel (the proof is the product) ── */}
      <ProofPanel market={market} />

      {error && <p className="text-sm text-red-400">{error}</p>}
    </main>
  );
}
