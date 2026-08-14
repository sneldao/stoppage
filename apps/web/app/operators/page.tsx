"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { VerifyLatestQuote } from "@/components/VerifyLatestQuote";
import { CodeBlock } from "@/components/CodeBlock";
import { ValidatorRail } from "@/components/ValidatorRail";
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

  const interfaceExample = `// What your validator program implements (shape, not literal code):
fn process_instruction(_pid, _accounts, data) -> ProgramResult {
    let claim = Claim::try_from_slice(data)?;        // fixture_ref, key, value, reference_ts, op
    let verdict: bool = verify_your_evidence(claim); // Merkle proof, price read, sig — anything
    set_return_data(&[verdict as u8]);               // THE interface: one byte of return data
    Ok(())
}

// resolve_market CPIs into market.oracle with the claim.
// Return data [1] -> receipt written, funds become claimable.
// Anything else     -> the whole transaction reverts.`;

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
            Bring your markets, bring your oracle. Funds move only when a
            proof verifies on-chain — no admin key, no dispute window.
            Settle on evidence, not authority.
          </p>
        </header>

        <section className="op-pillars">
          <div className="op-pillar">
            <h3>Proof-gated settlement</h3>
            <p>Funds move only if a CPI into your validator returns true. Anything else, the whole transaction reverts.</p>
          </div>
          <div className="op-pillar">
            <h3>Bring your own oracle</h3>
            <p>One receipt path, three structurally different oracles already live: TxLINE Merkle proof, Pyth guardian-verified, ed25519 operator attest. Your program plugs in the same way — if it returns a bool, it&apos;s a validator.</p>
          </div>
          <div className="op-pillar">
            <h3>Verifiable pricing</h3>
            <p>Optional Monte-Carlo fair value + bid/ask, snapshot hash anchored on-chain so anyone can reproduce the quote.</p>
          </div>
        </section>

        <section className="op-api">
          <div className="op-api-head">
            <h2>The interface: one CPI, one bool</h2>
            <span className="op-api-sub">your program decides</span>
          </div>
          <CodeBlock code={interfaceExample} />
          <p className="op-api-note">
            The market CPIs into whatever program is set as its <code>oracle</code>{" "}
            and reads one byte back. Anything but <code>[1]</code> reverts —
            no funds move. Your validator can only say yes or no; it never
            touches lamports. Ours:{" "}
            <a
              href="https://github.com/sneldao/stoppage/tree/main/programs/attestation_validator"
              target="_blank"
              rel="noopener noreferrer"
            >
              ~40 lines, dependency-free, deployed ↗
            </a>
          </p>
          <ValidatorRail />
        </section>

        <section className="op-api">
          <div className="op-api-head">
            <h2>The API</h2>
            <span className="op-api-sub">quote in, proof out</span>
          </div>
          <CodeBlock code={codeExample} />
          <VerifyLatestQuote quote={latest} market={latestMarket} />
          <p className="op-api-note">
            Quote + snapshot + model + seed fully determine the price.
            Reproduce it and confirm Matchkeeper wasn&apos;t gamed.
          </p>
        </section>

        <section className="op-moat">
          <h2>Why this is defensible</h2>
          <ul>
            <li><strong>Settlement is proof-gated.</strong> No operator discretion — the CPI result is the authority.</li>
            <li><strong>Oracle-agnostic, demonstrated.</strong> Merkle-proof sports oracle, guardian-verified price oracle, ed25519 attestor. Three, live.</li>
            <li><strong>The receipt is the artifact.</strong> Every settlement emits a proof users can re-verify trustlessly.</li>
            <li><strong>The schlep is the moat.</strong> Borsh, proof alignment, CPI path — if it were easy, Polymarket would already do it.</li>
          </ul>
        </section>

        <section className="op-cta">
          <p>Want to settle your markets on a proof instead of a key?</p>
          <Link href="/launch" className="op-cta-link">Launch a devnet market →</Link>
          <Link href="/calibration" className="op-cta-link">See the calibration board →</Link>
          <a
            href="https://github.com/sneldao/stoppage/blob/main/docs/OPERATORS.md"
            target="_blank"
            rel="noopener noreferrer"
            className="op-cta-link"
          >
            Read the operator integration guide ↗
          </a>
        </section>
      </div>
    </main>
  );
}
