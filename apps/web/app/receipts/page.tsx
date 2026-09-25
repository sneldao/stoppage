"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Market } from "@stoppage/sdk";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";
import { oracleInfoFor } from "@/lib/oracle";
import { exportCardAsPng } from "@/lib/share/exportCardAsPng";
import { buildProofTweet, buildTweetIntent, buildWeekReceiptTweet } from "@/lib/share/tweet";
import { ExpectationsStrip } from "@/components/ExpectationsStrip";

/**
 * /receipts — the cumulative Settled Week track record.
 *
 * Every proof-gated settlement on the market program (sports via TxLINE,
 * price windows via Pyth, attested paths) is a settled Market account. The
 * chain is the source of truth; /api/receipts scans it and only annotates
 * settle-tx signatures from the keeper ledger. The pitch is the count:
 * N proofs, 0 admin keys, every tx inspectable.
 */

interface ReceiptRowData {
  marketId: string;
  question: string;
  kind: string;
  matchId: string;
  outcome: string | null;
  oracle: string | null;
  settlesAt: string | null;
  closesAt: string;
  verifications: number;
  yesPool: number;
  noPool: number;
  settleSignature: string | null;
  week: boolean;
}

interface ReceiptsResponse {
  receipts: ReceiptRowData[];
  stats: { settledTotal: number; verifiedCount: number; weekCount: number };
  degraded?: boolean;
}

/** Response shape from /api/proof/[market] (same as ProofPanel's). */
interface ProofResponse {
  ok: boolean;
  signature?: string;
  statement?: string;
  merkleRoot?: string;
  outcome?: string;
  explorerUrl?: string;
  error?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function poolSol(row: ReceiptRowData): string {
  return ((row.yesPool + row.noPool) / 1e9).toFixed(2);
}

function ReceiptRow({
  row,
  market,
}: {
  row: ReceiptRowData;
  market: Market | undefined;
}) {
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [busy, setBusy] = useState<"card" | "tweet" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oracle = oracleInfoFor(row.oracle);

  const ensureProof = useCallback(async (): Promise<ProofResponse | null> => {
    if (proof) return proof;
    const resp = await fetch(`/api/proof/${row.marketId}`);
    const data: ProofResponse = await resp.json();
    if (!data.ok || !data.merkleRoot || !data.explorerUrl) {
      throw new Error(data.error ?? "Receipt not readable on-chain yet");
    }
    setProof(data);
    return data;
  }, [proof, row.marketId]);

  const downloadCard = async () => {
    if (!market) {
      setError("Market still loading from chain — try again in a moment.");
      return;
    }
    setBusy("card");
    setError(null);
    try {
      const p = await ensureProof();
      if (!p) return;
      await exportCardAsPng(
        {
          kind: "proof",
          market,
          merkleRoot: p.merkleRoot!,
          settleSig: p.signature ?? row.settleSignature ?? "",
          oracleLabel: oracle.name,
        },
        `stoppage-proof-${row.marketId.slice(0, 8)}.png`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build card");
    } finally {
      setBusy(null);
    }
  };

  const shareTweet = async () => {
    if (!market) {
      setError("Market still loading from chain — try again in a moment.");
      return;
    }
    setBusy("tweet");
    setError(null);
    try {
      const p = await ensureProof();
      if (!p) return;
      const explorerUrl = p.explorerUrl!;
      const text = row.week
        ? buildWeekReceiptTweet(market, explorerUrl)
        : buildProofTweet(
            market,
            p.merkleRoot!,
            explorerUrl,
            `${window.location.origin}/markets/${row.marketId}`,
            oracle.name === "Pyth"
              ? "Guardian-verified Pyth price confirmed in-tx."
              : `${oracle.name} proof verified in-tx.`
          );
      window.open(buildTweetIntent(text), "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build share");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`keystone-receipt-row receipts-row${row.week ? " receipts-row--week" : ""}`}>
      <span>
        {row.week && <span className="receipts-week-tag">Settled Week</span>}
        {row.question}
      </span>
      <span>
        <strong>{(row.outcome ?? "—").toUpperCase()}</strong> · {oracle.name} ·{" "}
        {row.verifications} verification{row.verifications === 1 ? "" : "s"} ·{" "}
        {poolSol(row)} SOL pool · settled {fmtDate(row.settlesAt)}
      </span>
      <span className="receipts-row-actions">
        <Link href={`/markets/${row.marketId}#proof`}>Verify ↗</Link>
        {row.settleSignature ? (
          <a
            href={`https://explorer.solana.com/tx/${row.settleSignature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            settle tx ↗
          </a>
        ) : (
          <a
            href={`https://explorer.solana.com/address/${row.marketId}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            account ↗
          </a>
        )}
        <button type="button" onClick={downloadCard} disabled={busy !== null}>
          {busy === "card" ? "Building…" : "Download card"}
        </button>
        <button type="button" onClick={shareTweet} disabled={busy !== null}>
          {busy === "tweet" ? "Building…" : "Share on X"}
        </button>
      </span>
      {error && <span className="receipts-row-error">{error}</span>}
    </div>
  );
}

export default function ReceiptsPage() {
  useMarkets();
  const markets = useStoppageStore((s) => s.markets);
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((d: ReceiptsResponse) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : "Failed to load receipts");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <div className="keystone-page">
        <section className="keystone-receipts" aria-label="Settlement receipts">
          <div className="keystone-receipts-head">
            <p className="eyebrow">The track record · Settled Week</p>
            <h1>
              {data ? `${data.stats.settledTotal} proofs` : "Counting proofs…"} · 0 admin keys ·
              devnet
            </h1>
            <p className="keystone-receipts-note">
              Every market here settled only after a validator proof verified on-chain — in the
              same transaction that released the funds. No admin key moved a lamport on any of
              them. The count also includes every 30-minute SOL/USD interval settle, which
              comes in too often to list one by one. New rows appear every weekend as the
              weekly SOL/USD window settles.
            </p>
            <ExpectationsStrip />
          </div>

          {loadError && <p className="receipts-row-error">{loadError}</p>}
          {!data && !loadError && <p>Fetching settled markets from chain…</p>}
          {data?.degraded && (
            <p className="receipts-row-error">
              RPC partially degraded — some accounts may be missing from this view.
            </p>
          )}

          {data?.receipts.map((row) => (
            <ReceiptRow key={row.marketId} row={row} market={markets[row.marketId]} />
          ))}
          {data && data.receipts.length === 0 && (
            <p>No settled markets found on devnet yet.</p>
          )}

          <p className="keystone-receipts-note">
            Devnet SOL only. Verify any row yourself: the market account, the settlement
            transaction, and the anchored proof are all public.{" "}
            <Link href="/keystone">Read the keystone story →</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
