/**
 * Browser-side fair-value re-run — the "no black box" verify loop (web half).
 *
 * This module re-exports the real @stoppage/quant model so the "Verify this
 * price" button re-derives a quote in the browser from the anchored snapshot
 * + published model params/seed, and confirms it matches the agent's signed
 * on-chain quote.
 */

import type { MarketPredicate, PricingResult, PricingSnapshot } from "@stoppage/sdk";
import {
  priceMarket as quantPriceMarket,
  DEFAULT_MODEL_PARAMS,
  type ModelParams,
} from "@stoppage/quant";

export type QuantParams = ModelParams;

export const DEFAULT_QUANT_PARAMS = DEFAULT_MODEL_PARAMS;

export function priceMarket(
  predicate: MarketPredicate,
  snapshot: PricingSnapshot,
  _params: ModelParams,
  seed: string
): PricingResult {
  // The published model params are the single source of truth in
  // packages/quant; the _params argument is kept for API symmetry with the
  // agent, but the browser verify loop always uses the committed defaults.
  return quantPriceMarket(predicate, snapshot, DEFAULT_MODEL_PARAMS, seed);
}
