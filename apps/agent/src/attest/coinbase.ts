/**
 * Coinbase Exchange source adapter — the agent-side facts source for
 * attested `price_above` markets while Pyth/Hermes is unavailable.
 * Boundary: an agent-side adapter, NOT part of @stoppage/txline (that
 * package is TxLINE-only per module boundaries; this is a different
 * operator data source feeding OUR OWN attestation validator).
 *
 * The public candles API is unauthenticated and serves minutely OHLC
 * history — an orphan market's reference time stays observable for as
 * long as Coinbase keeps the candle, which is exactly the property the
 * Hermes timestamped-endpoint refactor needed.
 *
 * Trust note: the trust anchor of the settlement path is NOT this HTTP
 * call; it is the operator's ed25519 signature over the observation,
 * verified on-chain by the attestation validator. This adapter exists so
 * the operator (us, in the reference deployment) attests to a price it
 * actually checked against a public source.
 */

const BASE = "https://api.exchange.coinbase.com";
const PRODUCT = process.env.COINBASE_PRODUCT ?? "SOL-USD";

/** [time, low, high, open, close, volume] — unix seconds, USD. */
type Candle = [number, number, number, number, number, number];

async function fetchCandles(startTs: number, endTs: number): Promise<Candle[]> {
  const url =
    `${BASE}/products/${PRODUCT}/candles?granularity=60` +
    `&start=${new Date(startTs * 1000).toISOString()}` +
    `&end=${new Date(endTs * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { "user-agent": "stoppage-agent" } });
  if (!res.ok) throw new Error(`Coinbase candles ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as Candle[] | { message: string };
  if (!Array.isArray(j)) throw new Error(`Coinbase candles error: ${(j as { message: string }).message}`);
  return j;
}

/**
 * The minute-candle CLOSE whose bucket contains `referenceTs` — the
 * first exchange observation at-or-after the reference time, matching
 * the `publish_time >= referenceTs` semantics the Pyth path used.
 * Returns null while the candle hasn't closed yet or the API has no
 * data for the bucket.
 */
export async function fetchSpotUsdAt(
  referenceTs: number
): Promise<{ usd: number; bucketTs: number } | null> {
  const bucketTs = Math.floor(referenceTs / 60) * 60;
  // Coinbase's start/end handling is unreliable on narrow ranges near
  // real time (intermittently returns [] even when the bucket exists);
  // ask for a wider window and pick the bucket ourselves. The newest
  // candle lags real time by a few minutes — callers retry until it
  // appears or the void grace is reached.
  const candles = await fetchCandles(bucketTs - 120, bucketTs + 300);
  const candle = candles.find((c) => c[0] === bucketTs);
  if (!candle) return null;
  return { usd: candle[4], bucketTs };
}

/** Latest spot — for threshold setting at market creation. */
export async function fetchSpotUsdNow(): Promise<number> {
  const res = await fetch(`${BASE}/products/${PRODUCT}/ticker`, {
    headers: { "user-agent": "stoppage-agent" },
  });
  if (!res.ok) throw new Error(`Coinbase ticker ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { price?: string };
  const usd = Number(j.price);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`Coinbase ticker returned no price: ${JSON.stringify(j).slice(0, 120)}`);
  }
  return usd;
}
