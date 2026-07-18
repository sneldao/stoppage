"use client";

import { useState } from "react";
import type { Market } from "@stoppage/sdk";

interface ProofPanelProps {
  market: Market;
}

/** Response shape from /api/proof/[market]. */
interface ProofResponse {
  ok: boolean;
  marketId: string;
  signature?: string;
  statement?: string;
  merkleRoot?: string;
  outcome?: string;
  outcomeBool?: number;
  timestamp?: number;
  explorerUrl?: string;
  error?: string;
}

type VerifyState =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "checking"; data: ProofResponse }
  | { kind: "receipt-checked"; data: ProofResponse }
  | { kind: "invalid"; data: ProofResponse; reason: string }
  | { kind: "error"; message: string };

/**
 * Truncate a hex string for display (e.g. "9f23…a0c1").
 */
function shortHash(hex: string | undefined, chars = 6): string {
  if (!hex || hex.length < chars * 2) return hex ?? "—";
  return `${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}

export function ProofPanel({ market }: ProofPanelProps) {
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });
  const explorerUrl = `https://explorer.solana.com/address/${market.id}?cluster=devnet`;

  if (market.status === "void") {
    return (
      <section className="proof-panel">
        <div className="proof-panel-head">
          <div>
            <p className="eyebrow">TxLINE verified</p>
            <h2>Proof status</h2>
          </div>
          <span className="proof-status">Voided</span>
        </div>
        <p>Market was voided — no proof to verify (full refunds).</p>
        <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">
          Inspect market account <span>↗</span>
        </a>
      </section>
    );
  }

  if (market.status !== "settled") {
    return (
      <section className="proof-panel">
        <div className="proof-panel-head">
          <div>
            <p className="eyebrow">TxLINE proof path</p>
            <h2>Resolution is waiting.</h2>
          </div>
          <span className="proof-status">Open</span>
        </div>
        <p>
          Matchkeeper is watching for TxLINE confirmation. It can submit this
          market&apos;s settlement only after the required proof validates on-chain.
        </p>
        <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">
          Inspect market account <span>↗</span>
        </a>
      </section>
    );
  }

  const onVerify = async () => {
    setVerify({ kind: "fetching" });
    try {
      const resp = await fetch(`/api/proof/${market.id}`);
      const data: ProofResponse = await resp.json();

      if (!data.ok || !data.merkleRoot || !data.statement || data.outcome === undefined) {
        setVerify({
          kind: "error",
          message: data.error ?? "Settlement proof not available on-chain yet",
        });
        return;
      }

      setVerify({ kind: "checking", data });

      // The settlement event stores the receipt, not the complete Merkle
      // branch. Check only what the browser can prove from that receipt.
      const outcomeMatches = data.outcome === market.outcome;
      const merkleRootValid = /^[0-9a-f]{64}$/i.test(data.merkleRoot);
      if (outcomeMatches && merkleRootValid) {
        setVerify({ kind: "receipt-checked", data });
      } else if (!outcomeMatches) {
        setVerify({
          kind: "invalid",
          data,
          reason: `Event outcome "${data.outcome}" doesn't match market outcome "${market.outcome}"`,
        });
      } else {
        setVerify({
          kind: "invalid",
          data,
          reason: "Anchored root format invalid",
        });
      }
    } catch (e) {
      setVerify({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to fetch proof",
      });
    }
  };

  return (
    <section className="proof-panel">
      <div className="proof-panel-head">
        <div>
          <p className="eyebrow">On-chain settlement</p>
          <h2>Settlement recorded.</h2>
        </div>
        <span className="proof-status verified">Receipt available</span>
      </div>
      <p>
        The program settled this market only after TxLINE proof validation on-chain.
        This view checks the settlement receipt against the recorded outcome.
      </p>

      <div className="proof-details">
        <div>
          <span>Outcome</span>
          <strong>{market.outcome}</strong>
        </div>
        <div>
          <span>Settled at</span>
          <strong>
            {market.settlesAt ? new Date(market.settlesAt).toLocaleString() : "—"}
          </strong>
        </div>
        <div>
          <span>Verifications</span>
          <strong>{market.verifications}</strong>
        </div>
      </div>

      <div className="proof-action">
        <button onClick={onVerify} disabled={verify.kind === "fetching"}>
          {verify.kind === "fetching" ? "Fetching…" : "Check settlement receipt"}
        </button>

        {verify.kind === "fetching" && (
          <p className="proof-verifying">
            <span className="proof-verifying-spinner" />
            Fetching settlement event from chain…
          </p>
        )}

        {verify.kind === "checking" && (
          <p className="proof-verifying">
            <span className="proof-verifying-spinner" />
            Checking the recorded outcome and anchored root…
          </p>
        )}

        {verify.kind === "receipt-checked" && (
          <>
            <div className="proof-layers">
              <div className="proof-layer proof-layer-valid">
                <span className="proof-layer-icon">✓</span>
                <div>
                  <div className="proof-layer-label">Settlement receipt</div>
                  <div className="proof-layer-desc">
                    Recorded outcome matches this market
                  </div>
                </div>
                <span className="proof-layer-status">Checked</span>
              </div>
              <div className="proof-layer proof-layer-pending">
                <span className="proof-layer-icon">i</span>
                <div>
                  <div className="proof-layer-label">Full Merkle branch</div>
                  <div className="proof-layer-desc">
                    Not retained in this browser receipt
                  </div>
                </div>
                <span className="proof-layer-status">Unavailable</span>
              </div>
            </div>
            <div className="proof-stat-detail">
              <span>Statement</span>
              <strong>{verify.data.statement}</strong>
            </div>
            <div className="proof-stat-detail">
              <span>Anchored root</span>
              <strong>{shortHash(verify.data.merkleRoot, 10)}</strong>
            </div>
            <p className="proof-hash">
              {verify.data.merkleRoot}
            </p>
            <p className="proof-valid-msg">
              The recorded settlement receipt matches this market&apos;s outcome and contains a valid anchored root. Inspect the settlement transaction for the on-chain validation.
            </p>
          </>
        )}

        {verify.kind === "invalid" && (
          <>
            <div className="proof-layers">
              <div className="proof-layer proof-layer-invalid">
                <span className="proof-layer-icon">✗</span>
                <div>
                  <div className="proof-layer-label">Verification failed</div>
                  <div className="proof-layer-desc">{verify.reason}</div>
                </div>
                <span className="proof-layer-status">Invalid</span>
              </div>
            </div>
            <p className="proof-invalid-msg">✗ {verify.reason}</p>
          </>
        )}

        {verify.kind === "error" && (
          <p className="proof-error-msg">
            Could not verify: {verify.message}
          </p>
        )}
      </div>

      {verify.kind === "receipt-checked" && verify.data.explorerUrl && (
        <a
          className="proof-explorer-link"
          href={verify.data.explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          View settlement transaction <span>↗</span>
        </a>
      )}

      <a className="proof-explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">
        Inspect verified market account <span>↗</span>
      </a>

      {market.verifications > 0 && (
        <p className="proof-confirmation">
          {market.verifications} verification{market.verifications > 1 ? "s" : ""} ·
          this market&apos;s outcome is independently attested on-chain.
        </p>
      )}
    </section>
  );
}
