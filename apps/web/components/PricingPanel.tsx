"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Market, PricingResult, PricingSnapshot } from "@stoppage/sdk";
import { priceMarket, DEFAULT_QUANT_PARAMS } from "@/lib/quant/fairValue";
import { deriveSeed } from "@stoppage/quant";

/**
 * PricingPanel — the verifiable quant market-maker surface for a focused
 * market (Phase 4).
 *
 * Shows the agent's live fair-value reference line beside the on-chain odds,
 * a bid/ask depth ladder, and the headline "Verify this price" action. The
 * verify loop re-runs the same pure quant model in the browser against the
 * quote's anchored snapshot + published model/seed and confirms it
 * reproduces the agent's quoted fair value — the "no black box" moment.
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

interface QuoteHistoryPoint {
  ts: number;
  fairValue: number;
  bid: number;
  ask: number;
  inventorySkew: number;
}

type VerifyState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "match"; computed: PricingResult }
  | { kind: "mismatch"; computed: PricingResult; reason: string }
  | { kind: "error"; message: string };

export function PricingPanel({ market }: { market: Market }) {
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [history, setHistory] = useState<QuoteHistoryPoint[]>([]);
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });
  const esRef = useRef<EventSource | null>(null);

  // Seed for the browser re-run must match the agent's to reproduce the quote.
  const seedFor = (q: QuotePayload) => deriveSeed(q.predicateKind, q.snapshot);

  useEffect(() => {
    let cancelled = false;

    const applyQuote = (q: QuotePayload) => {
      if (cancelled) return;
      if (q.marketId !== market.id) return;
      setQuote(q);
      setHistory((prev) => [...prev, {
        ts: q.ts,
        fairValue: q.result.fairValue,
        bid: q.result.bid,
        ask: q.result.ask,
        inventorySkew: q.inventorySkew,
      }].slice(-120));
    };

    // Initial poll.
    void fetch(`/api/quotes?marketId=${encodeURIComponent(market.id)}`)
      .then((r) => r.json())
      .then((data: { latest?: QuotePayload; history?: QuoteHistoryPoint[] }) => {
        if (cancelled) return;
        if (data.latest) setQuote(data.latest);
        if (data.history) setHistory(data.history.slice(-120));
      })
      .catch(() => {});

    // Live SSE — filter for this market.
    try {
      const es = new EventSource("/api/quotes/stream");
      esRef.current = es;
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "init" && Array.isArray(data.quotes)) {
            for (const q of data.quotes as QuotePayload[]) applyQuote(q);
          } else if (data.type === "quote") {
            applyQuote(data.quote as QuotePayload);
          }
        } catch {
          /* skip malformed */
        }
      };
      es.onerror = () => { /* proxy falls back to poll upstream */ };
    } catch {
      /* EventSource unsupported */
    }

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [market.id]);

  const onVerify = useCallback(() => {
    if (!quote) {
      setVerify({ kind: "error", message: "No quote to verify yet — waiting for Matchkeeper to price." });
      return;
    }
    setVerify({ kind: "running" });
    try {
      // priceMarket always uses the published DEFAULT_QUANT_PARAMS; the
      // _params argument is ignored by design so the verify loop cannot be
      // gamed by passing non-published parameters.
      const computed = priceMarket(
        market.predicate,
        quote.snapshot,
        DEFAULT_QUANT_PARAMS,
        seedFor(quote)
      );
      const drift = Math.abs(computed.fairValue - quote.result.fairValue);
      if (drift < 0.005) {
        setVerify({ kind: "match", computed });
      } else {
        setVerify({
          kind: "mismatch",
          computed,
          reason: `Re-run fair value ${Math.round(computed.fairValue * 100)}¢ differs from quoted ${Math.round(quote.result.fairValue * 100)}¢ by ${Math.round(drift * 100)}¢`,
        });
      }
    } catch (e) {
      setVerify({ kind: "error", message: e instanceof Error ? e.message : "Verify failed" });
    }
  }, [quote, market.predicate]);

  if (market.status !== "open") {
    return null; // pricing is a live, in-play surface
  }

  const onchainYes = market.yesPool + market.noPool > 0
    ? market.yesPool / (market.yesPool + market.noPool)
    : null;

  return (
    <section className="pricing-panel">
      <div className="pricing-panel-head">
        <div>
          <p className="eyebrow">Verifiable pricing</p>
          <h2>Matchkeeper fair value</h2>
        </div>
        {quote && <span className="pricing-model">model {quote.result.modelVersion}</span>}
      </div>

      {!quote ? (
        <p className="pricing-waiting">Matchkeeper is watching the match to publish a fair value…</p>
      ) : (
        <>
          <div className="pricing-fair">
            <div className="pricing-fair-main">
              <span className="pricing-fair-value">{Math.round(quote.result.fairValue * 100)}¢</span>
              <span className="pricing-fair-label">fair value · YES</span>
            </div>
            <div className="pricing-fair-ci">
              ±{Math.round(((quote.result.ci[1] - quote.result.ci[0]) / 2) * 100)}¢
              <small> {quote.result.sims > 0 ? `${quote.result.sims} sims` : "CI"}</small>
            </div>
          </div>

          {/* Fair-value sparkline (re-pricing as the match moves) */}
          <FairSparkline points={history} current={quote.result.fairValue} onchainYes={onchainYes} />

          {/* Bid / ask depth ladder */}
          <div className="pricing-depth">
            <div className="pricing-depth-row">
              <span className="pricing-depth-side pricing-depth-bid">BID</span>
              <strong>{Math.round(quote.result.bid * 100)}¢</strong>
              <span className="pricing-depth-spread">spread {Math.round((quote.result.ask - quote.result.bid) * 100)}¢</span>
              <strong>{Math.round(quote.result.ask * 100)}¢</strong>
              <span className="pricing-depth-side pricing-depth-ask">ASK</span>
            </div>
            <div className="pricing-depth-bar">
              <div className="pricing-depth-fill" style={{ width: `${quote.result.fairValue * 100}%` }} />
            </div>
            {onchainYes !== null && (
              <p className="pricing-onchain">
                On-chain odds imply {Math.round(onchainYes * 100)}¢ ·{" "}
                {diffLabel(quote.result.fairValue, onchainYes)}
              </p>
            )}
          </div>

          {/* Verify this price — the no-black-box moment */}
          <div className="pricing-verify">
            <button onClick={onVerify} disabled={verify.kind === "running"}>
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
                  <p>Your browser re-ran the open model on the anchored snapshot and got the same fair value. No black box.</p>
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
        </>
      )}
    </section>
  );
}

function diffLabel(fair: number, onchain: number): string {
  const d = fair - onchain;
  if (Math.abs(d) < 0.02) return "model and market agree";
  return d > 0 ? "model prices YES richer than the pool" : "model prices YES cheaper than the pool";
}

/**
 * Inline SVG fair-value sparkline with the on-chain odds as a reference line.
 * No chart dependency — keeps the client bundle lean.
 */
function FairSparkline({
  points,
  current,
  onchainYes,
}: {
  points: QuoteHistoryPoint[];
  current: number;
  onchainYes: number | null;
}) {
  const W = 280;
  const H = 56;
  const series = points.length > 1 ? points : [{ ts: 0, fairValue: current, bid: current, ask: current, inventorySkew: 0 }];
  const vals = series.map((p) => p.fairValue);
  const min = Math.min(...vals, onchainYes ?? 1);
  const max = Math.max(...vals, onchainYes ?? 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.fairValue).toFixed(1)}`).join(" ");

  return (
    <svg className="pricing-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Fair value over time">
      {onchainYes !== null && (
        <line x1={0} x2={W} y1={y(onchainYes)} y2={y(onchainYes)} className="pricing-spark-onchain" />
      )}
      <path d={path} className="pricing-spark-line" />
      <circle cx={x(series.length - 1)} cy={y(current)} r={3} className="pricing-spark-dot" />
    </svg>
  );
}
