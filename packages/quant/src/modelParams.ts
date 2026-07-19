/**
 * The published, open model assumptions.
 *
 * THIS FILE IS THE MODEL. It is committed, versioned, and importable by
 * anyone. The provability principle: priceMarket is a pure deterministic
 * function of (predicate, snapshot, params, seed), and `params` is exactly
 * this file. So a quoted fair value is reproducible by anyone who has the
 * anchored snapshot + this file + the seed — the model is not a black box.
 *
 * Change a number here => bump `version` => old pricing_receipts no longer
 * verify against the new model, which is the correct behaviour (the model
 * that produced a quote is identified by its version on the receipt).
 */

export interface ModelParams {
  /** Bumped on any parameter change; stored on every pricing receipt. */
  version: string;

  // ── Rate priors (per full match, both teams combined) ──────────────
  /** Average total goals per match (league-level prior). */
  goalRatePrior: number;
  /** Average total corners per match (league-level prior). */
  cornerRatePrior: number;

  // ── Blend between the match's own observed rate and the prior ──────
  /**
   * Weight on the match's own observed rate at kickoff (0 = pure prior).
   * Grows linearly to blendMax at minute 90, since more observed minutes
   * mean the match's own pace is more informative than the league prior.
   */
  blendMin: number;
  blendMax: number;

  /** Added-time allowance (minutes) appended to minutesRemaining. */
  stoppageMinutes: number;

  // ── Market-maker quoting (Goldman-style) ───────────────────────────
  /** Minimum half-spread in basis points of probability (model edge floor). */
  spreadBaseBps: number;
  /** Basis points added per unit of CI width (wider CI => wider spread). */
  spreadPerCiBps: number;
  /** Inventory skew: how far to shift the mid per unit of net inventory. */
  inventorySkew: number;

  /** Simulation count per price. Higher = tighter CI, slower. */
  simulations: number;
}

export const DEFAULT_MODEL_PARAMS: ModelParams = {
  version: "stoppage-quant-v1",
  goalRatePrior: 2.65,
  cornerRatePrior: 10.5,
  blendMin: 0.0,
  blendMax: 0.6,
  stoppageMinutes: 5,
  spreadBaseBps: 200, // 2% min half-spread
  spreadPerCiBps: 150, // +1.5% per unit CI width
  inventorySkew: 0.15,
  simulations: 10_000,
};
