"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { VerifyLatestQuote } from "@/components/VerifyLatestQuote";
import { CodeBlock } from "@/components/CodeBlock";
import { useAllQuotes } from "@/lib/quotes/useAllQuotes";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";

/**
 * Operators page — the B2B surface.
 *
 * Positions Stoppage as the proof-gated settlement primitive: operators
 * bring their markets and their own oracle, Stoppage gates fund release
 * on an on-chain proof verification. Verifiable pricing is the supporting
 * differentiator, not the product.
 */

export default function OperatorsPage() {
  useMarkets();
  const { quotes, streaming } = useAllQuotes();
  const latest = quotes[0];
  const latestMarket = useStoppageStore((s) => (latest ? s.markets[latest.marketId] : undefined));

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

        <ModelQuoteStrip quotes={quotes} streaming={streaming} hero />

        <header className="page-head page-head--compact">
          <p className="eyebrow">For operators</p>
          <h1>Settle markets only when a proof verifies</h1>
          <p className="page-lede page-lede--short">
            Bring your markets and your own oracle. Stoppage gates fund release on
            an on-chain proof verification — no admin keys, no multisigs, no dispute
            windows. Your users settle on evidence, not authority.
          </p>
        </header>

        <section className="op-pillars">
          <div className="op-pillar">
            <h3>Proof-gated settlement</h3>
            <p>Funds move only after a CPI into your validator returns true. If the proof fails, the whole transaction reverts.</p>
          </div>
          <div className="op-pillar">
            <h3>Bring your own oracle</h3>
            <p>The settlement contract is oracle-agnostic. Use the TxLINE reference, or plug in any validator that returns a bool.</p>
          </div>
          <div className="op-pillar">
            <h3>Verifiable pricing</h3>
            <p>Optional open Monte-Carlo fair value + bid/ask, with a snapshot hash anchored on-chain so anyone can reproduce the quote.</p>
          </div>
        </section>

        <section className="op-api">
          <div className="op-api-head">
            <h2>The API</h2>
            <span className="op-api-sub">quote in, proof out</span>
          </div>
          <CodeBlock code={codeExample} />
          <VerifyLatestQuote quote={latest} market={latestMarket} />
          <p className="op-api-note">
            The quote, snapshot, model, and seed fully determine the price.
            Reproduce it yourself to confirm Matchkeeper wasn&apos;t gamed.
          </p>
        </section>

        <section className="op-moat">
          <h2>Why this is defensible</h2>
          <ul>
            <li><strong>Settlement is proof-gated.</strong> No operator discretion, no admin key. The CPI result is the authority.</li>
            <li><strong>Oracle-agnostic by contract.</strong> The market program never learns which oracle produced the receipt.</li>
            <li><strong>The receipt is the artifact.</strong> Every settlement emits a proof a user can re-verify without trusting anyone.</li>
            <li><strong>The schlep is the moat.</strong> Borsh encoding, proof alignment, CPI path — if it were easy, Polymarket would already do it.</li>
          </ul>
        </section>

        <section className="op-cta">
          <p>Want to settle your markets on a proof instead of a key?</p>
          <Link href="/calibration" className="op-cta-link">See the calibration board →</Link>
        </section>
      </div>
    </main>
  );
}
