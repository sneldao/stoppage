"use client";

import type { MarketStatus } from "@stoppage/sdk";

const STEPS = [
  {
    id: "feed",
    label: "TxLINE feed",
    description: (status: MarketStatus) =>
      status === "open" ? "Match state live" : "Match state observed",
  },
  {
    id: "close",
    label: "Market close",
    description: (status: MarketStatus) =>
      status === "open" ? "Position window open" : "Outcome window closed",
  },
  {
    id: "proof",
    label: "Proof validation",
    description: (status: MarketStatus) =>
      status === "settled" ? "Validated on-chain" :
      status === "void"    ? "Not required" :
      status === "awaiting_settlement" ? "Validating now…" :
      "Required before settlement",
  },
  {
    id: "settlement",
    label: "Settlement",
    description: (status: MarketStatus) =>
      status === "settled" ? "Proof-backed result" :
      status === "void"    ? "Refund path active" :
      "Awaiting proof path",
  },
] as const;

function stepState(index: number, status: MarketStatus): "complete" | "active" | "void" | "pending" {
  const settled  = status === "settled";
  const voided   = status === "void";
  const waiting  = status === "awaiting_settlement";

  if (index === 0) return "complete";                                 // feed always done
  if (index === 1) return waiting || settled || voided ? "complete" : "active"; // market close
  if (index === 2) {
    if (settled) return "complete";
    if (voided)  return "void";
    if (waiting) return "active";
    return "pending";
  }
  if (index === 3) {
    if (settled) return "complete";
    if (voided)  return "void";
    return "pending";
  }
  return "pending";
}

export function ProofPath({ status }: { status: MarketStatus }) {
  return (
    <section className="proof-path" aria-label="Resolution path">
      <p className="eyebrow">TxLINE proof path</p>
      <ol className="proof-path-steps">
        {STEPS.map((step, i) => {
          const state = stepState(i, status);
          return (
            <li key={step.id} className={`proof-step proof-step--${state}`}>
              <div className="proof-step-node" aria-hidden="true">
                {state === "active" && <span className="proof-step-pulse" />}
                <span className="proof-step-num">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="proof-step-body">
                <strong>{step.label}</strong>
                <small>{step.description(status)}</small>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Connecting progress line */}
      <div className="proof-path-line" aria-hidden="true">
        <div
          className="proof-path-line-fill"
          style={{
            width: status === "settled" || status === "void" ? "100%" :
                   status === "awaiting_settlement" ? "62%" :
                   "12%",
          }}
        />
      </div>
    </section>
  );
}
