"use client";

import { useCallback, useState } from "react";
import type { Market } from "@stoppage/sdk";
import { useMarketQuote } from "@/lib/quotes/useMarketQuote";
import { verifyQuotePayload, type VerifyQuoteResult } from "@/lib/quotes/verifyQuote";
import { FairSparkline } from "@/components/FairSparkline";

/**
 * PricingPanel — verifiable quant market-maker surface for a focused market.
 */

type VerifyState =
  | { kind: "idle" }
  | { kind: "running" }
  | VerifyQuoteResult;

export function PricingPanel({ market }: { market: Market }) {
  const { quote, history } = useMarketQuote(market.id);
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });

  const onVerify = useCallback(() => {
    if (!quote) {
      setVerify({ kind: "error", message: "No quote to verify yet — waiting for Matchkeeper to price." });
      return;
    }
    setVerify({ kind: "running" });
    setVerify(verifyQuotePayload(quote, market.predicate));
  }, [quote, market.predicate]);

  if (market.status !== "open") {
    return null;
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

          <FairSparkline points={history} current={quote.result.fairValue} onchainYes={onchainYes} />

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
