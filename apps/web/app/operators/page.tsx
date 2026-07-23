"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { useAllQuotes } from "@/lib/quotes/useAllQuotes";

/**
 * Operators page — the B2B surface (Phase 5).
 *
 * Positions Stoppage as verifiable in-play pricing + settlement
 * infrastructure — the Goldman-style market-maker/layer, not a retail book.
 */

export default function OperatorsPage() {
  const { quotes, streaming } = useAllQuotes();
  const latest = quotes[0];

  const codeExample = latest
    ? `// Latest live quote received at ${new Date(latest.ts).toISOString()}
const es = new EventSource("/api/quotes/stream");
es.onmessage = (e) => {
  const { quote } = JSON.parse(e.data);
  // ${latest.label}
  // fairValue: ${(latest.result.fairValue * 100).toFixed(1)}¢
  // bid: ${(latest.result.bid * 100).toFixed(1)}¢  ask: ${(latest.result.ask * 100).toFixed(1)}¢
  // model: ${latest.result.modelVersion}
};`
    : `// 1. Subscribe to the live verifiable quote line
const es = new EventSource("/api/quotes/stream");
es.onmessage = (e) => {
  const { quote } = JSON.parse(e.data);
  // quote.result = { fairValue, bid, ask, ci, sims, modelVersion, seed }
  // quote.snapshot = anchored TxLINE state the model priced from
};

// 2. Reproduce the quote in your own infra (no black box)
const reproduced = priceMarket(
  quote.predicate,
  quote.snapshot,
  MODEL_PARAMS,
  quote.result.seed
);
// reproduced.fairValue === quote.result.fairValue -> verified

// 3. Settle through proof-gated on-chain resolution`;

  return (
    <main className="page-shell operators-page">
      <div className="page-shell-content">
        <div className="op-grooves" aria-hidden="true">
          <SpinningGrooves size={360} rings={5} color="var(--lime)" counterRotate speed={0.5} />
        </div>
        <header className="page-head">
          <p className="eyebrow">For operators</p>
          <h1>License verifiable in-play pricing &amp; settlement</h1>
          <p className="page-lede">
            Stoppage is the market-making infrastructure layer for in-play sports.
            We publish Monte-Carlo fair values, market-make around them, and settle
            through proof-gated on-chain resolution. The moat: data is Merkle-anchored,
            the model is open-source, and settlement is trustless.
          </p>
        </header>

        <ModelQuoteStrip quotes={quotes} streaming={streaming} />

        <section className="op-pillars">
          <div className="op-pillar">
            <h3>Fair pricing</h3>
            <p>Live Monte Carlo fair value + confidence interval per in-play market.</p>
          </div>
          <div className="op-pillar">
            <h3>Market-making</h3>
            <p>Bid/ask around fair value, spread by model uncertainty and inventory skew.</p>
          </div>
          <div className="op-pillar">
            <h3>Verifiable settlement</h3>
            <p>Resolution only after TxLINE Merkle proof validates on-chain.</p>
          </div>
        </section>

        <section className="op-api">
          <div className="op-api-head">
            <h2>The API</h2>
            <span className="op-api-sub">
              {streaming && <i className="live-dot" style={{ width: 5, height: 5, marginRight: 5 }} />}
              {streaming ? "quote in, proof out · live" : "quote in, proof out"}
            </span>
          </div>
          <pre className="op-code">{codeExample}</pre>
          <p className="op-api-note">
            The quote, snapshot, model, and seed fully determine the price.
            Reproduce it yourself to confirm Matchkeeper wasn&apos;t gamed.
          </p>
        </section>

        <section className="op-moat">
          <h2>Why this is defensible</h2>
          <ul>
            <li><strong>Data is provable.</strong> TxLINE Merkle anchors the match state.</li>
            <li><strong>Model is open.</strong> Committed, versioned, deterministic.</li>
            <li><strong>Settlement is proof-gated.</strong> No operator discretion.</li>
            <li><strong>P&amp;L is on-chain.</strong> Agent-vs-agent arenas settle trustlessly.</li>
          </ul>
        </section>

        <section className="op-cta">
          <p>Want the reference oracle running against your feed?</p>
          <Link href="/calibration" className="op-cta-link">See the calibration board →</Link>
        </section>
      </div>
    </main>
  );
}
