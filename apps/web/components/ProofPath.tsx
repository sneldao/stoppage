"use client";

import type { MarketStatus } from "@stoppage/sdk";

export function ProofPath({ status }: { status: MarketStatus }) {
  const settled = status === "settled";
  const voided = status === "void";
  const waiting = status === "awaiting_settlement";

  return (
    <section className="proof-path" aria-label="Resolution path">
      <p className="eyebrow">Resolution path</p>
      <ol>
        <li className="complete"><span>01</span><strong>TxLINE feed</strong><small>Match state observed</small></li>
        <li className={waiting || settled || voided ? "complete" : ""}><span>02</span><strong>Market close</strong><small>{status === "open" ? "Position window open" : "Outcome window closed"}</small></li>
        <li className={settled ? "complete" : voided ? "void" : waiting ? "active" : ""}><span>03</span><strong>Proof validation</strong><small>{settled ? "Validated on-chain" : voided ? "Not required" : "Required before settlement"}</small></li>
        <li className={settled ? "complete" : voided ? "void" : ""}><span>04</span><strong>Settlement</strong><small>{settled ? "Proof-backed result" : voided ? "Refund path active" : "Awaiting proof path"}</small></li>
      </ol>
    </section>
  );
}
