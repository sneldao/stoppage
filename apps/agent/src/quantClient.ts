/**
 * Quant client — the agent's bridge to the verifiable pricing brain.
 *
 * This module re-exports the real @stoppage/quant model. The fallback stub
 * has been removed now that Person 1's Monte Carlo brain is in place.
 */

import type { MarketPredicate, PricingResult, PricingSnapshot } from "@stoppage/sdk";
import {
  priceMarket as quantPriceMarket,
  DEFAULT_MODEL_PARAMS,
  type ModelParams,
} from "@stoppage/quant";

export type { ModelParams as QuantParams };

export const DEFAULT_QUANT_PARAMS = DEFAULT_MODEL_PARAMS;

export interface QuantModel {
  priceMarket: (
    predicate: MarketPredicate,
    snapshot: PricingSnapshot,
    params: ModelParams,
    seed: string
  ) => PricingResult;
}

/** Resolve the active quant model. Today this is the real @stoppage/quant. */
export function getQuantModel(): QuantModel {
  return {
    priceMarket: (predicate, snapshot, _params, seed) =>
      quantPriceMarket(predicate, snapshot, DEFAULT_MODEL_PARAMS, seed),
  };
}
