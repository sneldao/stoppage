"use client";

import Link from "next/link";

/**
 * Operators page — the B2B surface (Phase 5).
 *
 * Positions Stoppage as verifiable in-play pricing + settlement
 * infrastructure — the Goldman-style market-maker/layer, not a retail book.
 * The moat is "provably fair pricing + settlement" that web2 can't credibly
 * offer because their models are proprietary. The API shown here is the real
 * surface that already exists (live quotes + proof-gated settlement); the
 * on-chain pricing_receipt attestation (Person 2) is the missing half that
 * closes the B2B trust loop.
 */

export default function OperatorsPage() {
  return (
    <main className="page-shell operators-page">
      <header className="page-head">
        <p className="eyebrow">For operators</p>
        <h1>License verifiable in-play pricing &amp; settlement</h1>
        <p className="page-lede">
          Stoppage is the market-making infrastructure layer for in-play sports. We publish
          Monte-Carlo fair values and market-make around them, and settle through proof-gated
          on-chain resolution. The differentiator is structural: the data is Merkle-anchored,
          the model is open-source and reproducible, and settlement is proof-gated. A web2
          operator can&apos;t credibly promise any of that — their edge is the black box.
        </p>
      </header>

      <section className="op-pillars">
        <div className="op-pillar">
          <h3>Fair pricing</h3>
          <p>Live Monte Carlo fair value per in-play market, with a confidence interval from simulation variance.</p>
        </div>
        <div className="op-pillar">
          <h3>Market-making</h3>
          <p>Bid/ask around fair value, spread widened by model uncertainty and inventory skew. Kelly-sized depth.</p>
        </div>
        <div className="op-pillar">
          <h3>Verifiable settlement</h3>
          <p>Resolution only after TxLINE Merkle proof validates on-chain. Outcomes are auditable, not operator-set.</p>
        </div>
      </section>

      <section className="op-api">
        <div className="op-api-head">
          <h2>The API</h2>
          <span className="op-api-sub">quote in, proof out</span>
        </div>
        <pre className="op-code">{`// 1. Subscribe to the live verifiable quote line
const es = new EventSource("/api/quotes/stream");
es.onmessage = (e) => {
  const { quote } = JSON.parse(e.data);
  // quote.result = { fairValue, bid, ask, ci, sims, modelVersion, seed }
  // quote.snapshot = anchored TxLINE state the model priced from
};

// 2. Reproduce the quote in your own infra (no black box)
const reproduced = priceMarket(
  quote.predicate,
  quote.snapshot,    // byte-identical to what was anchored
  MODEL_PARAMS,
  quote.result.seed
);
// reproduced.fairValue === quote.result.fairValue  -> verified

// 3. Settle through proof-gated on-chain resolution
//    (resolve_market CPIs into TxLINE validate_stat)`}</pre>
        <p className="op-api-note">
          The quote, the snapshot, the model, and the seed fully determine the price. Reproduce
          it yourself to confirm Matchkeeper wasn&apos;t gamed — that&apos;s the entire trust model.
        </p>
      </section>

      <section className="op-moat">
        <h2>Why this is defensible</h2>
        <ul>
          <li><strong>Data is provable.</strong> TxLINE Merkle anchors the match state — you can verify the input.</li>
          <li><strong>Model is open.</strong> Committed, versioned, deterministic — you can reproduce the output.</li>
          <li><strong>Settlement is proof-gated.</strong> No operator discretion over the outcome.</li>
          <li><strong>P&amp;L is on-chain.</strong> Agent-vs-agent arenas settle trustlessly — the only honest leaderboard.</li>
        </ul>
      </section>

      <section className="op-cta">
        <p>Want the reference oracle running against your feed?</p>
        <Link href="/calibration" className="op-cta-link">See the calibration board →</Link>
      </section>
    </main>
  );
}
