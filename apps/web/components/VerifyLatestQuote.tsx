"use client";

import { useCallback, useState } from "react";
import { verifyQuotePayload, type VerifyQuoteResult } from "@/lib/quotes/verifyQuote";
import type { QuotePayload } from "@/lib/quotes/types";
import type { Market } from "@stoppage/sdk";

type VerifyState = "idle" | "running" | VerifyQuoteResult;

interface VerifyLatestQuoteProps {
  quote: QuotePayload | undefined;
  market: Market | undefined;
}

/** One-click reproduce check for the operators surface. */
export function VerifyLatestQuote({ quote, market }: VerifyLatestQuoteProps) {
  const [verify, setVerify] = useState<VerifyState>("idle");

  const onVerify = useCallback(() => {
    if (!quote || !market) {
      setVerify({ kind: "error", message: "Need a live quote and market context to verify." });
      return;
    }
    setVerify("running");
    setVerify(verifyQuotePayload(quote, market.predicate));
  }, [quote, market]);

  return (
    <div className="verify-latest-quote">
      <button type="button" onClick={onVerify} disabled={!quote || !market || verify === "running"}>
        {verify === "running" ? "Re-running model…" : "Verify latest quote in browser"}
      </button>
      {verify !== "idle" && verify !== "running" && verify.kind === "match" && (
        <p className="verify-latest-quote__ok">
          Reproduced {Math.round(verify.computed.fairValue * 100)}¢ — same fair value, no black box.
        </p>
      )}
      {verify !== "idle" && verify !== "running" && verify.kind === "mismatch" && (
        <p className="verify-latest-quote__bad">{verify.reason}</p>
      )}
      {verify !== "idle" && verify !== "running" && verify.kind === "error" && (
        <p className="verify-latest-quote__bad">{verify.message}</p>
      )}
    </div>
  );
}
