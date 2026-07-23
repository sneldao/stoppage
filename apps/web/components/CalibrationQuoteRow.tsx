"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { FairSparkline } from "@/components/FairSparkline";
import { useMarketQuote } from "@/lib/quotes/useMarketQuote";
import { verifyQuotePayload, type VerifyQuoteResult } from "@/lib/quotes/verifyQuote";
import type { QuotePayload } from "@/lib/quotes/types";
import { useStoppageStore } from "@/store";

type RowVerifyState = "idle" | "running" | VerifyQuoteResult;

export function CalibrationQuoteRow({ quote }: { quote: QuotePayload }) {
  const market = useStoppageStore((s) => s.markets[quote.marketId]);
  const { history } = useMarketQuote(quote.marketId);
  const [verify, setVerify] = useState<RowVerifyState>("idle");

  const onVerify = useCallback(() => {
    if (!market) {
      setVerify({ kind: "error", message: "Market not loaded yet." });
      return;
    }
    setVerify("running");
    setVerify(verifyQuotePayload(quote, market.predicate));
  }, [quote, market]);

  const verifyLabel =
    verify === "running"
      ? "…"
      : verify !== "idle" && verify.kind === "match"
      ? "✓"
      : verify !== "idle" && verify.kind === "mismatch"
      ? "✗"
      : "Verify";

  return (
    <div className="cal-row">
      <Link href={`/markets/${quote.marketId}`} className="cal-market cal-market-link">
        {quote.label}
      </Link>
      <FairSparkline
        points={history}
        current={quote.result.fairValue}
        width={100}
        height={32}
        className="cal-spark"
      />
      <strong key={quote.ts} className="score-flash">
        {Math.round(quote.result.fairValue * 100)}¢
      </strong>
      <span className="cal-depth">
        {Math.round(quote.result.bid * 100)}–{Math.round(quote.result.ask * 100)}¢
      </span>
      <span className="cal-ci">
        ±{Math.round(((quote.result.ci[1] - quote.result.ci[0]) / 2) * 100)}¢
      </span>
      <span className="cal-model">{quote.result.modelVersion}</span>
      <button
        type="button"
        className={`cal-verify${verify !== "idle" && verify !== "running" && verify.kind === "match" ? " cal-verify--ok" : ""}${verify !== "idle" && verify !== "running" && verify.kind === "mismatch" ? " cal-verify--bad" : ""}`}
        onClick={onVerify}
        disabled={verify === "running" || !market}
        title={
          verify !== "idle" && verify !== "running" && verify.kind === "error"
            ? verify.message
            : verify !== "idle" && verify !== "running" && verify.kind === "mismatch"
            ? verify.reason
            : "Re-run the open model in your browser"
        }
      >
        {verifyLabel}
      </button>
    </div>
  );
}
