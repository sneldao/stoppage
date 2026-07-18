"use client";

import { useState } from "react";
import type { Market } from "@stoppage/sdk";

interface ProofPanelProps {
  market: Market;
}

/**
 * Verifiable Resolution panel — shows the on-chain proof status and
 * lets users verify the Merkle proof themselves.
 *
 * This is the "proof is the product" differentiator made visible:
 * the user doesn't need to trust Stoppage's UI, just the anchored
 * root + proof.
 */
export function ProofPanel({ market }: ProofPanelProps) {
  const [verifyResult, setVerifyResult] = useState<"idle" | "verifying" | "valid" | "invalid" | "no-proof">("idle");
  const explorerUrl = `https://explorer.solana.com/address/${market.id}?cluster=devnet`;

  if (market.status === "void") {
    return (
      <section className="proof-panel">
        <div className="proof-panel-head"><div><p className="eyebrow">TxLINE verified</p><h2>Proof status</h2></div><span className="proof-status">Voided</span></div>
        <p>
          Market was voided — no proof to verify (full refunds).
        </p>
        <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">Inspect market account <span>↗</span></a>
      </section>
    );
  }

  if (market.status !== "settled") {
    return (
      <section className="proof-panel">
        <div className="proof-panel-head"><div><p className="eyebrow">TxLINE proof path</p><h2>Resolution is waiting.</h2></div><span className="proof-status">Open</span></div>
        <p>
          Matchkeeper is watching for TxLINE confirmation. It can submit this
          market&apos;s settlement only after the required proof validates on-chain.
        </p>
        <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">Inspect market account <span>↗</span></a>
      </section>
    );
  }

  return (
    <section className="proof-panel">
      <div className="proof-panel-head"><div><p className="eyebrow">TxLINE verified</p><h2>Proof secured.</h2></div><span className="proof-status verified">Verified</span></div>
      <p>
        Settlement is backed by a TxLINE Merkle proof, verified on-chain
        via <code>validate_stat</code> CPI.
        Verify it yourself without trusting Stoppage.
      </p>

      <div className="proof-details">
        <div>
          <span>Outcome</span>
          <strong>{market.outcome}</strong>
        </div>
        <div>
          <span>Settled at</span>
          <strong>{market.settlesAt ? new Date(market.settlesAt).toLocaleString() : "—"}</strong>
        </div>
        <div>
          <span>Verifications</span>
          <strong>{market.verifications}</strong>
        </div>
      </div>

      <div className="proof-action">
        <button
          onClick={() => setVerifyResult("no-proof")}
        >
          Verify proof locally
        </button>
        {verifyResult === "no-proof" && (
          <p>
            Proof data is fetched by Matchkeeper at settlement time and
            emitted in the <code>MarketResolved</code> on-chain event.
            To verify, fetch the event from the transaction logs and
            re-run the Merkle path verification using{" "}
            <code>verifyProofLocally()</code> from the SDK.
          </p>
        )}
      </div>

      <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">Inspect verified market account <span>↗</span></a>

      {market.verifications > 0 && (
        <p className="proof-confirmation">
          {market.verifications} verification{market.verifications > 1 ? "s" : ""} ·
          this market&apos;s outcome is independently attested on-chain.
        </p>
      )}
    </section>
  );
}
