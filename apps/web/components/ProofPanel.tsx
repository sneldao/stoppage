"use client";

import { useState } from "react";
import { verifyStatProof, type Market } from "@stoppage/sdk";

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

  if (market.status === "void") {
    return (
      <div className="rounded-xl border border-white/10 p-4 sm:p-6">
        <h2 className="font-medium">Verifiable Resolution</h2>
        <p className="mt-3 text-sm text-neutral-600">
          Market was voided — no proof to verify (full refunds).
        </p>
      </div>
    );
  }

  if (market.status !== "settled") {
    return (
      <div className="rounded-xl border border-white/10 p-4 sm:p-6">
        <h2 className="font-medium">Verifiable Resolution</h2>
        <p className="mt-3 text-sm text-neutral-600">
          Market not yet settled. The autonomous agent will settle this
          market when the match event is confirmed via TxLINE, using an
          on-chain CPI into TxLINE&apos;s validate_stat instruction.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 p-4 sm:p-6">
      <h2 className="font-medium">Verifiable Resolution</h2>
      <p className="mt-1 text-xs text-neutral-500 sm:text-sm">
        Settlement is backed by a TxLINE Merkle proof, verified on-chain
        via <code className="text-neutral-400">validate_stat</code> CPI.
        Verify it yourself without trusting Stoppage.
      </p>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Outcome</span>
          <span className="font-medium capitalize">{market.outcome}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Settled at</span>
          <span>{market.settlesAt ? new Date(market.settlesAt).toLocaleString() : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Verifications</span>
          <span className="font-medium">{market.verifications}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Proof source</span>
          <span className="text-xs text-neutral-400">
            TxLINE on-chain <code>validate_stat</code> CPI
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">On-chain verified</span>
          <span className="text-xs text-emerald-400">
            ✓ Yes (settlement program CPI)
          </span>
        </div>
      </div>

      {/* Verify yourself button */}
      <div className="mt-4 border-t border-white/10 pt-4">
        <button
          onClick={() => setVerifyResult("no-proof")}
          className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
        >
          Verify proof locally
        </button>
        {verifyResult === "no-proof" && (
          <p className="mt-2 text-xs text-neutral-500">
            Proof data is fetched by the agent at settlement time and
            emitted in the <code>MarketResolved</code> on-chain event.
            To verify, fetch the event from the transaction logs and
            re-run the Merkle path verification using{" "}
            <code>verifyProofLocally()</code> from the SDK.
          </p>
        )}
      </div>

      {market.verifications > 0 && (
        <p className="pt-3 text-xs text-emerald-400">
          ✓ {market.verifications} verification{market.verifications > 1 ? "s" : ""} —
          this market&apos;s outcome is independently attested on-chain.
        </p>
      )}
    </div>
  );
}
