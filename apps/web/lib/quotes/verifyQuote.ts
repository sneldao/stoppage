import type { MarketPredicate, PricingResult } from "@stoppage/sdk";
import { deriveSeed } from "@stoppage/quant";
import { priceMarket, DEFAULT_QUANT_PARAMS } from "@/lib/quant/fairValue";
import type { QuotePayload } from "@/lib/quotes/types";

export type VerifyQuoteResult =
  | { kind: "match"; computed: PricingResult }
  | { kind: "mismatch"; computed: PricingResult; reason: string }
  | { kind: "error"; message: string };

/** Re-run the open model on the anchored snapshot and compare fair value. */
export function verifyQuotePayload(
  quote: QuotePayload,
  predicate: MarketPredicate,
  expectedFairValue: number = quote.result.fairValue
): VerifyQuoteResult {
  try {
    const seed = deriveSeed(quote.predicateKind, quote.snapshot);
    const computed = priceMarket(predicate, quote.snapshot, DEFAULT_QUANT_PARAMS, seed);
    const drift = Math.abs(computed.fairValue - expectedFairValue);
    if (drift < 0.005) {
      return { kind: "match", computed };
    }
    return {
      kind: "mismatch",
      computed,
      reason: `Re-run fair value ${Math.round(computed.fairValue * 100)}¢ differs from quoted ${Math.round(expectedFairValue * 100)}¢ by ${Math.round(drift * 100)}¢`,
    };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Verify failed",
    };
  }
}
