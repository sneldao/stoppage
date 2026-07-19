/**
 * Deterministic PRNG for reproducible Monte Carlo.
 *
 * Reproducibility is the offchain half of the no-black-box proof: given the
 * same (predicate, snapshot, modelParams, seed), priceMarket must return the
 * exact same fair value on any machine, any run. Math.random() would break
 * that contract. mulberry32 is tiny, fast, and bit-stable across JS engines;
 * cyrb53 gives a stable 53-bit seed from an arbitrary string. Both are pure,
 * dependency-free, and defined here so the model is fully inspectable.
 */

/**
 * cyrb53 string hash. Stable across engines (uses only charCodeAt and
 * Math.imul, both well-defined). Returns a positive integer up to 2^53.
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Hash a list of string parts into a single numeric seed. Used to derive
 * the RNG stream from (seed, predicate kind, threshold, snapshot hash) so
 * different markets get independent streams even with the same seed string.
 */
export function hashSeed(...parts: string[]): number {
  return cyrb53(parts.join("|"));
}

/**
 * mulberry32 PRNG. Returns a function producing floats in [0,1). State is
 * a 32-bit integer advanced deterministically.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample from a Poisson(λ) distribution using Knuth's algorithm, driven by
 * the seeded RNG. Exact and cheap for the small λ this model uses (match
 * goal/corner counts are typically < 15). Returns a non-negative integer.
 */
export function poisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
