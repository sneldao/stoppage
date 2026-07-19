"use client";

import { useCallback, useEffect, useState } from "react";
import type { Market, PricingReceipt as OnchainPricingReceipt, PricingResult, PricingSnapshot } from "@stoppage/sdk";
import { hashSnapshot, deriveSeed } from "@stoppage/quant";
import { priceMarket, DEFAULT_QUANT_PARAMS } from "@/lib/quant/fairValue";

/**
 * PricingReceiptPanel — the on-chain-attestation counterpart to ProofPanel
 * (Phase 2/4).
 *
 * Renders the live verifiable quote AND the on-chain pricing receipt (if one
 * has been attested). The receipt carries the anchored snapshot hash, model
 * version, fair value, bid/ask, and agent signature — the inputs needed for
 * the "Verify this price" no-black-box loop.
 */

interface QuotePayload {
  marketId: string;
  label: string;
  predicateKind: string;
  snapshot: PricingSnapshot;
  result: PricingResult;
  inventorySkew: number;
  ts: number;
}

interface ReceiptResponse {
  ok: boolean;
  receipt?: OnchainPricingReceipt;
  explorerUrl?: string;
  error?: string;
}

type VerifyState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "match"; computed: PricingResult }
  | { kind: "mismatch"; computed: PricingResult; reason: string }
  | { kind: "error"; message: string };

function formatHash(hex: string): string {
  return `0x${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

function formatSignature(hex: string): string {
  return `${hex.slice(0, 16)}…${hex.slice(-16)}`;
}

export function PricingReceiptPanel({ market }: { market: Market }) {
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [receipt, setReceipt] = useState<OnchainPricingReceipt | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    const apply = (q: QuotePayload) => {
      if (!cancelled && q.marketId === market.id) setQuote(q);
    };
    void fetch(`/api/quotes?marketId=${encodeURIComponent(market.id)}`)
      .then((r) => r.json())
      .then((d: { latest?: QuotePayload }) => { if (d.latest) apply(d.latest); })
      .catch(() => {});
    try {
      const es = new EventSource("/api/quotes/stream");
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const q = data.type === "quote" ? data.quote : null;
          if (q) apply(q as QuotePayload);
        } catch { /* skip */ }
      };
      return () => { cancelled = true; es.close(); };
    } catch {
      return () => { cancelled = true; };
    }
  }, [market.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pricing-receipt/${encodeURIComponent(market.id)}`)
      .then((r) => r.json())
      .then((d: ReceiptResponse) => {
        if (cancelled) return;
        if (d.ok && d.receipt) {
          setReceipt(d.receipt);
          setReceiptUrl(d.explorerUrl ?? null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [market.id]);

  const onVerify = useCallback(() => {
    if (!quote || !receipt) {
      setVerify({ kind: "error", message: "Need both a live quote and an on-chain receipt to verify." });
      return;
    }
    setVerify({ kind: "running" });
    try {
      const computedHash = hashSnapshot(quote.snapshot);
      if (computedHash !== receipt.snapshotHash) {
        setVerify({
          kind: "error",
          message: "Reconstructed snapshot hash does not match the on-chain receipt. The quoted snapshot may differ from the anchored one.",
        });
        return;
      }

      const seed = deriveSeed(quote.predicateKind, quote.snapshot);
      // priceMarket always uses the published DEFAULT_QUANT_PARAMS; the
      // _params argument is ignored by design so the verify loop cannot be
      // gamed by passing non-published parameters.
      const computed = priceMarket(market.predicate, quote.snapshot, DEFAULT_QUANT_PARAMS, seed);
      const drift = Math.abs(computed.fairValue - receipt.fairValue);
      if (drift < 0.005) {
        setVerify({ kind: "match", computed });
      } else {
        setVerify({
          kind: "mismatch",
          computed,
          reason: `Re-run fair value ${Math.round(computed.fairValue * 100)}¢ differs from attested ${Math.round(receipt.fairValue * 100)}¢ by ${Math.round(drift * 100)}¢`,
        });
      }
    } catch (e) {
      setVerify({ kind: "error", message: e instanceof Error ? e.message : "Verify failed" });
    }
  }, [quote, receipt, market.predicate]);

  if (market.status !== "open") return null;

  const hasReceipt = receipt !== null;
  const hasQuote = quote !== null;
  const canVerify = hasQuote && hasReceipt;

  return (
    <section className="pricing-receipt">
      <div className="pricing-receipt-head">
        <div>
          <p className="eyebrow">Pricing attestation</p>
          <h2>Verifiable reference line</h2>
        </div>
        <span className="pricing-receipt-badge">
          {hasReceipt ? "On-chain" : hasQuote ? "Live" : "Pending"}
        </span>
      </div>

      {!hasQuote && !hasReceipt && (
        <p className="pricing-receipt-waiting">Awaiting Matchkeeper&apos;s first quote for this market…</p>
      )}

      {(hasQuote || hasReceipt) && (
        <>
          <p className="pricing-receipt-note">
            The agent prices this market from a Merkle-anchored TxLINE snapshot and a
            published, open-source model. Anyone can reproduce the quote — that is the
            on-chain attestation&apos;s purpose.
          </p>

          <div className="pricing-receipt-grid">
            <div>
              <span>Snapshot hash</span>
              <strong className="pricing-receipt-hash">
                {hasReceipt ? formatHash(receipt.snapshotHash) : quote ? "Pending attestation" : "—"}
              </strong>
            </div>
            <div>
              <span>Model version</span>
              <strong>{hasReceipt ? receipt.modelVersion : quote ? quote.result.modelVersion : "—"}</strong>
            </div>
            <div>
              <span>Fair value</span>
              <strong>
                {hasReceipt
                  ? `${Math.round(receipt.fairValue * 100)}¢`
                  : quote
                    ? `${Math.round(quote.result.fairValue * 100)}¢`
                    : "—"}
              </strong>
            </div>
            <div>
              <span>Seed</span>
              <strong className="pricing-receipt-hash">
                {quote ? `${quote.result.seed.slice(0, 18)}…` : "—"}
              </strong>
            </div>
            {hasReceipt && (
              <div>
                <span>Agent signature</span>
                <strong className="pricing-receipt-hash">{formatSignature(receipt.agentSignature)}</strong>
              </div>
            )}
            {hasReceipt && (
              <div>
                <span>Attested at</span>
                <strong>{new Date(receipt.ts).toLocaleString()}</strong>
              </div>
            )}
          </div>

          <div className="pricing-verify">
            <button onClick={onVerify} disabled={!canVerify || verify.kind === "running"}>
              {verify.kind === "running" ? "Re-running model…" : "Verify this price"}
            </button>

            {verify.kind === "running" && (
              <p className="pricing-verifying"><span className="pricing-verifying-spinner" /> Re-deriving the quote in your browser…</p>
            )}
            {verify.kind === "match" && (
              <div className="pricing-verify-ok">
                <span className="pricing-verify-icon">✓</span>
                <div>
                  <strong>Reproduced.</strong>
                  <p>Your browser re-hashed the snapshot and re-ran the open model. The attested fair value matches — no black box.</p>
                </div>
              </div>
            )}
            {verify.kind === "mismatch" && (
              <div className="pricing-verify-bad">
                <span className="pricing-verify-icon">✗</span>
                <div>
                  <strong>Quote not reproduced.</strong>
                  <p>{verify.reason}</p>
                </div>
              </div>
            )}
            {verify.kind === "error" && (
              <p className="pricing-verify-err">{verify.message}</p>
            )}
          </div>

          {hasReceipt && receiptUrl && (
            <p className="pricing-receipt-foot">
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                View on-chain receipt in Explorer →
              </a>
            </p>
          )}

          {!hasReceipt && hasQuote && (
            <p className="pricing-receipt-foot">
              Live quote is streaming; on-chain attestation will appear once the agent publishes it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
