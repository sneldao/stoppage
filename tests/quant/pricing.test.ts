// @stoppage/quant — pure unit tests.
//
// These verify the two contracts that make the layer trustworthy as the
// offchain half of the no-black-box proof:
//   1. DETERMINISM — same inputs => same PricingResult, anywhere.
//   2. SANITY/CALIBRATION — the math behaves (probabilities in [0,1],
//      monotone in threshold, decays with time, backtest math is correct).
//
// Run: npm run test:quant
// (Separate from tests/market.ts, which needs a local validator.)

import * as chai from "chai";
const { expect } = chai;
import {
  DEFAULT_MODEL_PARAMS,
  backtest,
  canonicalSnapshotJson,
  hashSnapshot,
  kellyFraction,
  makeQuote,
  mulberry32,
  poisson,
  priceMarket,
  simulate,
  type ModelParams,
  type PricingSnapshot,
} from "@stoppage/quant";
import { sha256 } from "js-sha256";

const FAST_PARAMS: ModelParams = { ...DEFAULT_MODEL_PARAMS, simulations: 3000 };

function snapshot(over: Partial<PricingSnapshot>): PricingSnapshot {
  return {
    matchId: "FRA-SPA",
    fixtureId: 18237038,
    minute: 60,
    score: { home: 1, away: 1 },
    corners: { home: 4, away: 3 },
    cards: { homeYellow: 1, homeRed: 0, awayYellow: 2, awayRed: 0 },
    seq: 100,
    ts: 1750000000000,
    ...over,
  };
}

const goalsOver3 = {
  kind: "total_goals_over" as const,
  matchId: "FRA-SPA",
  params: { team: "", threshold: 3 },
};

const cornersOver9 = {
  kind: "corners_over" as const,
  matchId: "FRA-SPA",
  params: { team: "", threshold: 9 },
};

describe("quant determinism (no-black-box reproducibility)", () => {
  it("returns byte-identical results for the same inputs", () => {
    const s = snapshot({});
    const a = priceMarket(goalsOver3, s, FAST_PARAMS, "seed-A");
    const b = priceMarket(goalsOver3, s, FAST_PARAMS, "seed-A");
    expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
  });

  it("changes the fair value when the seed changes (streams are independent)", () => {
    const s = snapshot({});
    const a = priceMarket(goalsOver3, s, FAST_PARAMS, "seed-A");
    const b = priceMarket(goalsOver3, s, FAST_PARAMS, "seed-B");
    expect(a.fairValue).to.not.equal(b.fairValue);
    expect(a.modelVersion).to.equal(b.modelVersion);
  });

  it("is reproducible across instances (simulate directly)", () => {
    const s = snapshot({});
    const a = simulate(goalsOver3, s, FAST_PARAMS, "repro");
    const b = simulate(goalsOver3, s, FAST_PARAMS, "repro");
    expect(a.probability).to.equal(b.probability);
    expect(a.ci[0]).to.equal(b.ci[0]);
    expect(a.ci[1]).to.equal(b.ci[1]);
  });

  it("derives independent streams per market (same seed, different threshold)", () => {
    const s = snapshot({});
    const over2 = { ...goalsOver3, params: { team: "", threshold: 2 } };
    const a = priceMarket(goalsOver3, s, FAST_PARAMS, "shared-seed");
    const b = priceMarket(over2, s, FAST_PARAMS, "shared-seed");
    // Same seed, different threshold => different probability (and stream).
    expect(a.fairValue).to.not.equal(b.fairValue);
  });
});

describe("quant sanity", () => {
  it("produces probabilities and quotes within [0,1] with bid <= fair <= ask", () => {
    const s = snapshot({});
    const r = priceMarket(goalsOver3, s, FAST_PARAMS, "sane");
    expect(r.fairValue).to.be.at.least(0).and.at.most(1);
    expect(r.bid).to.be.at.least(0).and.at.most(r.fairValue);
    expect(r.ask).to.be.at.most(1).and.at.least(r.fairValue);
    expect(r.bid).to.be.below(r.ask);
    expect(r.sims).to.equal(FAST_PARAMS.simulations);
    expect(r.modelVersion).to.equal(FAST_PARAMS.version);
    expect(r.seed).to.equal("sane");
  });

  it("keeps bid <= ask at the [0,1] rails (extreme fair value)", () => {
    const near1 = makeQuote(0.999, [0.998, 1], DEFAULT_MODEL_PARAMS);
    expect(near1.bid).to.be.at.most(near1.ask);
    expect(near1.ask).to.be.at.most(1);
    const near0 = makeQuote(0.001, [0, 0.002], DEFAULT_MODEL_PARAMS);
    expect(near0.bid).to.be.at.least(0);
    expect(near0.bid).to.be.at.most(near0.ask);
  });
});

describe("quant model behaviour", () => {
  it("is monotone decreasing in threshold (higher line => lower P(over))", () => {
    const s = snapshot({ minute: 30, score: { home: 1, away: 0 } });
    const p1 = priceMarket({ ...goalsOver3, params: { team: "", threshold: 1 } }, s, FAST_PARAMS, "m").fairValue;
    const p3 = priceMarket({ ...goalsOver3, params: { team: "", threshold: 3 } }, s, FAST_PARAMS, "m").fairValue;
    const p6 = priceMarket({ ...goalsOver3, params: { team: "", threshold: 6 } }, s, FAST_PARAMS, "m").fairValue;
    expect(p1).to.be.above(p3);
    expect(p3).to.be.above(p6);
  });

  it("decays as the match progresses toward full time (same score)", () => {
    const early = snapshot({ minute: 10, score: { home: 1, away: 0 } });
    const late = snapshot({ minute: 85, score: { home: 1, away: 0 } });
    const pe = priceMarket({ ...goalsOver3, params: { team: "", threshold: 3 } }, early, FAST_PARAMS, "decay").fairValue;
    const pl = priceMarket({ ...goalsOver3, params: { team: "", threshold: 3 } }, late, FAST_PARAMS, "decay").fairValue;
    expect(pl).to.be.below(pe);
  });

  it("prices corners too (uses the corner-rate prior)", () => {
    const s = snapshot({ minute: 40 });
    const r = priceMarket(cornersOver9, s, FAST_PARAMS, "corners");
    expect(r.fairValue).to.be.at.least(0).and.at.most(1);
  });

  it("refuses to price unsupported predicate kinds rather than mislead", () => {
    const s = snapshot({});
    const card = { kind: "card_shown" as const, matchId: "FRA-SPA", params: {} };
    expect(() => simulate(card, s, FAST_PARAMS, "x")).to.throw(/unsupported predicate kind/);
  });
});

describe("quant market-maker", () => {
  it("widens the spread with model uncertainty", () => {
    const tight = makeQuote(0.5, [0.49, 0.51], DEFAULT_MODEL_PARAMS);
    const wide = makeQuote(0.5, [0.3, 0.7], DEFAULT_MODEL_PARAMS);
    expect(wide.ask - wide.bid).to.be.above(tight.ask - tight.bid);
  });

  it("skews the mid down when long yes (attracts unwinders)", () => {
    const flat = makeQuote(0.5, [0.45, 0.55], DEFAULT_MODEL_PARAMS, { netYes: 0, notional: 1 });
    const long = makeQuote(0.5, [0.45, 0.55], DEFAULT_MODEL_PARAMS, { netYes: 1, notional: 1 });
    expect((long.bid + long.ask) / 2).to.be.below((flat.bid + flat.ask) / 2);
  });

  it("computes Kelly correctly (p=0.6 @ 2.0 => 0.2; fair bet @ 0.5 => 0; no-edge => 0)", () => {
    expect(kellyFraction(0.6, 2.0)).to.approximately(0.2, 1e-9);
    expect(kellyFraction(0.3, 2.0)).to.equal(0); // negative edge clamped
    expect(kellyFraction(0.5, 2.0)).to.equal(0); // exactly fair => no edge
  });
});

describe("quant RNG + snapshot hash", () => {
  it("poisson mean converges to lambda", () => {
    const rng = mulberry32(12345);
    let sum = 0;
    const N = 50_000;
    for (let i = 0; i < N; i++) sum += poisson(rng, 3.0);
    const mean = sum / N;
    expect(mean).to.be.closeTo(3.0, 0.05);
  });

  it("hashSnapshot is deterministic and changes when the snapshot changes", () => {
    const s = snapshot({});
    const s2 = snapshot({ score: { home: 2, away: 1 } });
    expect(hashSnapshot(s)).to.equal(hashSnapshot(s)); // stable
    expect(hashSnapshot(s)).to.not.equal(hashSnapshot(s2)); // sensitive
    expect(hashSnapshot(snapshot({ minute: 60 }))).to.not.equal(hashSnapshot(snapshot({ minute: 61 })));
  });

  it("hashSnapshot matches SHA-256 of the canonical JSON serialization", () => {
    const s = snapshot({});
    const expected = sha256(canonicalSnapshotJson(s));
    expect(hashSnapshot(s)).to.equal(expected);
  });
});

describe("quant calibration backtest", () => {
  it("returns a perfect-ish diagonal for a calibrated synthetic set", () => {
    // 10 buckets, 10 points each at the bucket midpoint, with exactly
    // round(10*p) true outcomes => predicted == actual within rounding.
    const points: { p: number; outcome: boolean }[] = [];
    for (let b = 0; b < 10; b++) {
      const p = (b + 0.5) / 10;
      const trues = Math.round(10 * p);
      for (let i = 0; i < 10; i++) points.push({ p, outcome: i < trues });
    }
    const r = backtest(points);
    expect(r.n).to.equal(100);
    expect(r.brier).to.be.above(0).and.below(0.25);
    for (const bucket of r.buckets) {
      if (bucket.count > 0) {
        expect(Math.abs(bucket.predicted - bucket.actual)).to.be.below(0.06);
      }
    }
  });

  it("returns zeros for an empty input", () => {
    const r = backtest([]);
    expect(r.n).to.equal(0);
    expect(r.brier).to.equal(0);
    expect(r.buckets).to.have.length(0);
  });
});
