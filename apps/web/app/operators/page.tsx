"use client";

import Link from "next/link";
import { SpinningGrooves } from "@/components/SpinningGrooves";
import { ModelQuoteStrip } from "@/components/ModelQuoteStrip";
import { VerifyLatestQuote } from "@/components/VerifyLatestQuote";
import { CodeBlock } from "@/components/CodeBlock";
import { ValidatorRail } from "@/components/ValidatorRail";
import { ElectricBorder } from "@/components/ElectricBorder";
import { KeystoneBanner } from "@/components/KeystoneBanner";
import { useAllQuotes } from "@/lib/quotes/useAllQuotes";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";

/**
 * Operators page — the B2B surface.
 * Proof-gated settlement is the product. Pricing is the supporting exhibit.
 */

export default function OperatorsPage() {
  useMarkets();
  const { quotes, streaming } = useAllQuotes();
  const latest = quotes[0];
  const latestMarket = useStoppageStore((s) => (latest ? s.markets[latest.marketId] : undefined));

  const codeExample = latest
    ? `const es = new EventSource("/api/quotes/stream");
es.onmessage = (e) => {
  const { quote } = JSON.parse(e.data);
  // ${latest.label}
  // fairValue: ${(latest.result.fairValue * 100).toFixed(1)}¢
  // bid: ${(latest.result.bid * 100).toFixed(1)}¢  ask: ${(latest.result.ask * 100).toFixed(1)}¢
};`
    : `const es = new EventSource("/api/quotes/stream");
es.onmessage = (e) => {
  const { quote } = JSON.parse(e.data);
  // quote.result.fairValue, bid, ask, seed, snapshot
};`;

  const interfaceExample = `fn process_instruction(_pid, _accounts, data) -> ProgramResult {
    let claim = Claim::try_from_slice(data)?;
    let verdict: bool = verify_your_evidence(claim);
    set_return_data(&[verdict as u8]); // [1] settles; anything else reverts
    Ok(())
}`;

  return (
    <main className="page-shell operators-page">
      <div className="page-shell-content">
        <div className="op-grooves" aria-hidden="true">
          <SpinningGrooves size={360} rings={5} color="var(--lime)" counterRotate speed={0.5} />
        </div>

        <ElectricBorder variant="lime" speed={0.7} displacement={18} active>
          <ModelQuoteStrip quotes={quotes} streaming={streaming} hero />
        </ElectricBorder>

        <header className="page-head page-head--compact">
          <p className="eyebrow">For operators</p>
          <h1>Settle only when a proof verifies</h1>
          <p className="page-lede page-lede--short">
            Bring the market and the oracle. Funds move on a bool — not a key.
          </p>
        </header>

        <ol className="cal-steps" aria-label="What you get">
          <li><b>CPI</b> one byte back</li>
          <li><b>Oracle</b> yours, or ours</li>
          <li><b>Quote</b> optional, reproducible</li>
        </ol>
        <details className="disclose">
          <summary>The three claims <i aria-hidden="true" /></summary>
          <div className="disclose__body">
            <p>
              Funds move only if a CPI into your validator returns true — anything
              else reverts. Three oracles already live on the same receipt path:
              TxLINE Merkle, Pyth, ed25519 attest. Pricing is optional Monte Carlo
              anchored to a snapshot hash.
            </p>
          </div>
        </details>

        <section className="op-api">
          <div className="op-api-head">
            <h2>One CPI, one bool</h2>
            <span className="op-api-sub">your program decides</span>
          </div>
          <p className="op-api-lede">
            <code>[1]</code> writes the receipt and funds become claimable.
            Anything else, the transaction reverts.
          </p>
          <details className="disclose">
            <summary>Show the validator shape <i aria-hidden="true" /></summary>
            <div className="disclose__body">
              <CodeBlock code={interfaceExample} />
              <p>
                Your validator can only say yes or no; it never touches lamports.{" "}
                <a
                  href="https://github.com/sneldao/stoppage/tree/main/programs/attestation_validator"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Worked example ↗
                </a>
              </p>
            </div>
          </details>
          <ValidatorRail />
        </section>

        <section className="op-api">
          <div className="op-api-head">
            <h2>Quote in, proof out</h2>
            <span className="op-api-sub">optional pricing line</span>
          </div>
          <details className="disclose">
            <summary>Subscribe to the stream <i aria-hidden="true" /></summary>
            <div className="disclose__body">
              <CodeBlock code={codeExample} />
            </div>
          </details>
          <VerifyLatestQuote quote={latest} market={latestMarket} />
        </section>

        <section className="op-moat">
          <h2>Why it holds</h2>
          <ul className="skim-list">
            <li>
              <strong>Proof-gated.</strong>
              CPI false → the tx reverts.
            </li>
            <li>
              <strong>Oracle-agnostic.</strong>
              Merkle, Pyth, and attest already live.
            </li>
            <li>
              <strong>The receipt is the artifact.</strong>
              Anyone can re-verify it.
            </li>
            <li>
              <strong>The schlep is the moat.</strong>
              Borsh, proofs, CPI — if it were easy, it would already exist.
            </li>
          </ul>
        </section>

        <section className="op-cta">
          <KeystoneBanner />
          <div className="op-cta-links">
            <Link href="/launch" className="op-cta-link">Launch a market →</Link>
            <Link href="/calibration" className="op-cta-link">Calibration board →</Link>
            <a
              href="https://github.com/sneldao/stoppage/blob/main/docs/OPERATORS.md"
              target="_blank"
              rel="noopener noreferrer"
              className="op-cta-link"
            >
              Integration guide ↗
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
