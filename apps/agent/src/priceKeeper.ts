/**
 * Price market keeper — the "oracle-agnostic" claim made operational.
 *
 * Shared Pyth market primitives (create / settle / recover) plus the
 * interval loop that creates `price_above` markets on a price feed and
 * settles them against a Pyth PriceUpdateV2 observation, using the same
 * resolve_market -> settle_from_proof -> attest_verification bundle the
 * TxLINE keeper uses. The settlement transaction still fails atomically if
 * the pyth_validator CPI rejects the observation, so fund release for a
 * price market is gated on the same proof receipt path as a sports market.
 *
 * The primitives are exported so the weekly Settled Week keeper
 * (weekKeeper.ts) can run a Friday-open → Sunday-close window market
 * through the exact same settle path.
 *
 * Two transactions per settlement, with an explicit boundary:
 *   1. post the Pyth price update (permissionless oracle plumbing — any
 *      keeper can do this for any market; security is not affected by who
 *      writes the observation, only by what the validator verifies),
 *   2. the atomic proof-gated bundle (resolve + settle + attest).
 *
 * Usage:
 *   npx tsx apps/agent/src/index.ts price --live-tx [--interval=1800]
 *
 * Environment:
 *   SOLANA_KEYPAIR_PATH — keeper wallet (pays bonds + tx fees)
 *   SOLANA_RPC_URL      — default https://api.devnet.solana.com
 *   PRICE_FEED_ID       — Pyth feed id hex (default SOL/USD)
 *   PRICE_SYMBOL        — display symbol + market match_id (default SOL/USD)
 *   HERMES_URL          — default https://hermes.pyth.network
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { createRequire } from "node:module";

// The receiver's ESM entry transitively imports a jito-ts deep path without
// a file extension, which Node ESM rejects. Its CJS entry resolves cleanly —
// the package exports maps "require" to dist/cjs (verified). Type-only
// import keeps full typing; it is erased at compile time.
const { PythSolanaReceiver } = createRequire(import.meta.url)(
  "@pythnetwork/pyth-solana-receiver"
) as typeof import("@pythnetwork/pyth-solana-receiver");
import {
  ATTESTATION_OPS,
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  buildAttestationMessage,
  buildAttestVerificationIx,
  buildCreateMarketIx,
  buildResolveMarketIxFromOracle,
  buildSettleFromProofIx,
  buildVoidMarketIx,
  findMarketPdaFromPredicate,
  parseMarket,
  pythOracle,
  PYTH_FEED_IDS,
  MARKET_ACCOUNT_SIZE,
  MARKET_PROGRAM_ID,
  PYTH_VALIDATOR_PROGRAM_ID,
  type MarketPredicate,
} from "@stoppage/sdk";
import {
  ATTEST_STAT_KEYS,
  buildSettlementBundle,
  ensureAttestationConfig,
  fixtureRefForPriceMarket,
  loadAttestor,
  sendAndConfirm,
} from "./attestationKeeper";
import { fetchSpotUsdAt, fetchSpotUsdNow } from "./attest/coinbase";
import { sweepCreatorBonds } from "./claims";

// Pyth Core upgrade (2026-08-26): Hermes requires Bearer auth. Get a key
// from Pyth Terminal (free trial) and set PYTH_API_KEY on the agent host.
const HERMES = process.env.HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const PYTH_API_KEY = process.env.PYTH_API_KEY ?? "";
const FEED_ID = process.env.PRICE_FEED_ID ?? PYTH_FEED_IDS["SOL/USD"];
export const PRICE_SYMBOL = process.env.PRICE_SYMBOL ?? "SOL/USD";
export const MAX_STALENESS_SECONDS = 120;
// Pyth majors carry expo -8 (price in 1e-8 USD).
const FEED_EXPO = -8;

/**
 * Which oracle newly created price markets bind to: "pyth" (Hermes +
 * PriceUpdateV2 — needs PYTH_API_KEY) or "attestation" (operator-signed
 * observation over a public spot source — no Pyth dependency). The
 * settle path always dispatches on the market's BOUND oracle, so mixed
 * generations coexist; this env only controls what we create.
 */
export const PRICE_ORACLE = process.env.PRICE_ORACLE ?? "pyth";

interface HermesUpdate {
  binary: { data: string[] };
  parsed: Array<{
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }>;
}

async function fetchHermes(url: string): Promise<HermesUpdate> {
  const res = await fetch(url, {
    headers: PYTH_API_KEY ? { authorization: `Bearer ${PYTH_API_KEY}` } : {},
  });
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — PYTH_API_KEY missing/lapsed (Hermes auth is mandatory since the Pyth Core upgrade)"
        : "";
    throw new Error(`Hermes ${res.status}: ${await res.text()}${hint}`);
  }
  const j = (await res.json()) as HermesUpdate;
  if (!j.parsed?.[0] || j.parsed[0].id !== FEED_ID) {
    throw new Error("Hermes returned no update for the feed");
  }
  return j;
}

export async function fetchLatestUpdate(): Promise<HermesUpdate> {
  return fetchHermes(
    `${HERMES}/v2/updates/price/latest?ids[]=${FEED_ID}&encoding=base64&parsed=true`
  );
}

/**
 * The latest price update published at-or-before `publishTime`
 * (Hermes `/v2/updates/price/{ts}`). Unlike `latest`, this is
 * deterministic for a closed market — it can recover an in-window
 * observation for a market that closed minutes or days ago.
 */
export async function fetchUpdateAt(publishTime: number): Promise<HermesUpdate> {
  return fetchHermes(
    `${HERMES}/v2/updates/price/${publishTime}?ids[]=${FEED_ID}&encoding=base64&parsed=true`
  );
}

/** Spot price in native units (i64) — Hermes for pyth-mode, Coinbase
 *  ticker for attestation mode (thresholds just need a sane spot). */
export async function spotNative(): Promise<bigint> {
  if (PRICE_ORACLE === "attestation") {
    return BigInt(Math.round((await fetchSpotUsdNow()) * 10 ** -FEED_EXPO));
  }
  const j = await fetchLatestUpdate();
  return BigInt(j.parsed[0].price.price);
}

/** Round spot to whole USD so thresholds and statements stay legible. */
export function roundThresholdUsd(spot: bigint, deltaUsd = 0): {
  roundedUsd: number;
  thresholdRaw: bigint;
} {
  const thresholdUsd = Number(spot) * 10 ** FEED_EXPO + deltaUsd;
  const roundedUsd = Math.round(thresholdUsd);
  return { roundedUsd, thresholdRaw: BigInt(roundedUsd) * 10n ** BigInt(-FEED_EXPO) };
}

export interface TrackedPriceMarket {
  predicate: MarketPredicate;
  marketPda: PublicKey;
  referenceTs: number;
  thresholdRaw: bigint;
  /** Bound oracle program (base58); absent ⇒ legacy pyth-bound. */
  oracle?: string;
}

/** The on-chain fact produced by a live settlement. */
export interface PriceSettleFact {
  signature: string;
  outcome: "yes" | "no";
  statement: string;
  observedPrice: bigint;
  observedPublishTime: number;
}

/**
 * Shared context for the Pyth market primitives. `tracked` is owned by the
 * caller (interval keeper, week keeper) so recovery + dedup semantics stay
 * per-process even when both keepers share a wallet.
 */
export interface PythMarketContext {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  log: (msg: string) => void;
  tracked: Map<string, TrackedPriceMarket>;
  /** Emitted only for real on-chain facts (never in dry-run). */
  onCreated?: (m: TrackedPriceMarket, signature: string | null) => void;
  onSettled?: (m: TrackedPriceMarket, fact: PriceSettleFact) => void;
  onVoided?: (m: TrackedPriceMarket, signature: string | null) => void;
}

/** void_market is permissionless after closes_at + 1h program grace; +900s buffer. */
export const PRICE_VOID_GRACE_SECONDS = 3600 + 900;

/**
 * Outcome of a settle attempt:
 *  - "settled": the proof-gated bundle landed (or dry-run).
 *  - "pending": window still open, no post-close observation yet.
 *  - "unresolvable": window fully passed AND Hermes has no observation
 *    in it — the feed gapped for longer than MAX_STALENESS_SECONDS at
 *    close, so no proof exists. Callers should void past grace.
 *  - "unsupported": the market's bound oracle isn't one this keeper can
 *    drive (e.g. a pyth-bound market while Pyth is paused). Not
 *    transient — void past grace.
 */
export type PriceSettleResult = "settled" | "pending" | "unresolvable" | "unsupported";

export function priceStatement(thresholdRaw: bigint, referenceTs: number): string {
  return `sol_above:${Number(thresholdRaw) / 10 ** -FEED_EXPO}:${referenceTs}`;
}

/** Scan on-chain for open price markets this keeper owns (restart recovery).
 *  Both keepers share a wallet, so `accept` must filter by matchId shape. */
export async function recoverOpenPriceMarkets(
  ctx: PythMarketContext,
  accept: (matchId: string) => boolean
): Promise<void> {
  const accounts = await ctx.connection.getProgramAccounts(
    new PublicKey(MARKET_PROGRAM_ID),
    {
      filters: [
        { dataSize: MARKET_ACCOUNT_SIZE },
        // kind byte (price_above = 4); memcmp takes base58 — bs58(0x04) = "5"
        { memcmp: { offset: 8, bytes: "5" } },
        // creator
        {
          memcmp: {
            offset: 8 + 1 + 32 + 8 + 8,
            bytes: ctx.wallet.publicKey.toBase58(),
          },
        },
      ],
    }
  );
  for (const { account, pubkey } of accounts) {
    const m = parseMarket(account.data, pubkey.toBase58());
    if (m.status !== "open") continue;
    if (!accept(m.predicate.matchId)) continue;
    const refTs = Date.parse(m.closesAt) / 1000;
    const thresholdRaw = BigInt(Number(m.predicate.params.threshold ?? 0));
    if (ctx.tracked.has(pubkey.toBase58())) continue;
    ctx.tracked.set(pubkey.toBase58(), {
      predicate: m.predicate,
      marketPda: pubkey,
      referenceTs: refTs,
      thresholdRaw,
      oracle: m.oracle,
    });
    ctx.log(`recovered open market ${pubkey.toBase58()} (ref ${new Date(refTs * 1000).toISOString()})`);
  }
}

/**
 * Create (or adopt) a `price_above` market whose close/reference time is
 * `referenceTs`. The threshold is the spot at call time (+ optional delta),
 * which is what makes a Friday-created week market a "Friday-open line".
 */
export async function ensurePriceMarket(
  ctx: PythMarketContext,
  opts: { matchId: string; referenceTs: number; deltaUsd?: number }
): Promise<TrackedPriceMarket | null> {
  const { roundedUsd, thresholdRaw } = roundThresholdUsd(await spotNative(), opts.deltaUsd ?? 0);
  const boundOracle =
    PRICE_ORACLE === "attestation" ? ATTESTATION_VALIDATOR_PROGRAM_ID : PYTH_VALIDATOR_PROGRAM_ID;
  const predicate: MarketPredicate = {
    kind: "price_above",
    // The market PDA seeds don't include closes_at, so the round's
    // reference time must be part of match_id — otherwise every round
    // with the same threshold collides on the same PDA.
    matchId: opts.matchId,
    params: { team: "", threshold: Number(thresholdRaw) },
  };
  const [marketPda] = findMarketPdaFromPredicate(predicate);
  const pdaAddress = marketPda.toBase58();
  const tracked = ctx.tracked.get(pdaAddress);
  if (tracked) return tracked;

  const existing = await ctx.connection.getAccountInfo(marketPda);
  if (existing) {
    ctx.log(`market already exists: ${pdaAddress}`);
    const m: TrackedPriceMarket = {
      predicate,
      marketPda,
      referenceTs: opts.referenceTs,
      thresholdRaw,
      oracle: parseMarket(existing.data, pdaAddress).oracle,
    };
    ctx.tracked.set(pdaAddress, m);
    return m;
  }

  ctx.log(
    `creating market: ${PRICE_SYMBOL} above $${roundedUsd} at ${new Date(opts.referenceTs * 1000).toISOString()} (${pdaAddress})`
  );
  if (!ctx.dryRun) {
    const ix = buildCreateMarketIx({
      creator: ctx.wallet.publicKey,
      predicate,
      closesAt: opts.referenceTs,
      oracle: new PublicKey(boundOracle),
    });
    const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: ctx.wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(ctx.wallet);
    const sig = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await ctx.connection.confirmTransaction(sig, "confirmed");
    const status = await ctx.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    if (status.value[0]?.err) throw new Error(`create tx failed on-chain: ${JSON.stringify(status.value[0].err)} (${sig})`);
    ctx.log(`market created, tx ${sig}`);
    const m: TrackedPriceMarket = { predicate, marketPda, referenceTs: opts.referenceTs, thresholdRaw, oracle: boundOracle };
    ctx.tracked.set(pdaAddress, m);
    ctx.onCreated?.(m, sig);
    return m;
  }
  const m: TrackedPriceMarket = { predicate, marketPda, referenceTs: opts.referenceTs, thresholdRaw };
  ctx.tracked.set(pdaAddress, m);
  return null;
}

/** Probe offsets past the reference time when hunting the first post-close observation. */
const PROBE_OFFSETS_SECONDS = [2, 5, 15, 30, 60, 90, MAX_STALENESS_SECONDS];

/**
 * Settle a tracked price market: fetch the earliest Hermes observation
 * inside [referenceTs, referenceTs + MAX_STALENESS_SECONDS] via the
 * timestamped endpoint (not `latest` — publish_time only moves forward,
 * so a polled latest can never re-enter a missed window; that bug
 * stranded every market the keeper was down through). Post the
 * PriceUpdateV2, then land the atomic resolve + settle + attest bundle.
 *
 * The window is evaluated against `publish_time`, not wall-clock age —
 * a market orphaned for days still settles if an in-window observation
 * exists. Only a feed gap > MAX_STALENESS_SECONDS at close is
 * unresolvable.
 */
export async function settlePriceMarket(
  ctx: PythMarketContext,
  m: TrackedPriceMarket
): Promise<PriceSettleResult> {
  const statement = priceStatement(m.thresholdRaw, m.referenceTs);
  const nowSec = Math.floor(Date.now() / 1000);

  // Dispatch on the oracle the market was BOUND to at creation, not on
  // PRICE_ORACLE — an attestation-bound market must never see the Pyth
  // path and vice versa.
  const boundOracle = m.oracle ?? PYTH_VALIDATOR_PROGRAM_ID;
  if (boundOracle === ATTESTATION_VALIDATOR_PROGRAM_ID) {
    return settlePriceMarketAttested(ctx, m, statement, nowSec);
  }
  if (boundOracle !== PYTH_VALIDATOR_PROGRAM_ID) return "unsupported";
  if (PRICE_ORACLE === "attestation") {
    // Pyth-bound legacy market while Pyth is paused — we cannot produce
    // a guardian-verified observation, so it can never resolve.
    return "unsupported";
  }

  // Earliest retrievable post-close observation: probe at increasing
  // offsets; the first response with publish_time >= ref wins.
  let update: HermesUpdate | null = null;
  for (const off of PROBE_OFFSETS_SECONDS) {
    const probeTs = Math.min(m.referenceTs + off, nowSec);
    const j = await fetchUpdateAt(probeTs);
    const pt = j.parsed[0].price.publish_time;
    if (pt >= m.referenceTs && pt <= m.referenceTs + MAX_STALENESS_SECONDS) {
      update = j;
      break;
    }
    if (probeTs >= m.referenceTs + MAX_STALENESS_SECONDS) break;
  }
  if (!update) {
    const windowExpired = nowSec > m.referenceTs + MAX_STALENESS_SECONDS;
    if (windowExpired) {
      ctx.log(
        `no in-window observation for ${m.marketPda.toBase58()} (feed gap >= ${MAX_STALENESS_SECONDS}s at ${new Date(m.referenceTs * 1000).toISOString()}) — unresolvable`
      );
      return "unresolvable";
    }
    ctx.log(`no post-close observation yet for ${m.marketPda.toBase58()}; retry next tick`);
    return "pending";
  }
  const price = BigInt(update.parsed[0].price.price);
  const conf = BigInt(update.parsed[0].price.conf);
  const publishTime = update.parsed[0].price.publish_time;
  const outcome = price >= m.thresholdRaw ? 0 : 1;
  ctx.log(
    `settling ${m.marketPda.toBase58()}: ${statement} observed=${price} (${publishTime}) -> ${outcome === 0 ? "YES" : "NO"}`
  );
  if (ctx.dryRun) {
    ctx.tracked.delete(m.marketPda.toBase58());
    return "settled";
  }

  // tx 1: post the guardian-verified observation on-chain (ephemeral
  // PriceUpdateV2 account). Permissionless oracle plumbing.
  const receiver = new PythSolanaReceiver({
    connection: ctx.connection,
    wallet: new Wallet(ctx.wallet),
  });
  const txb = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
  await txb.addPostPriceUpdates(update.binary.data);
  let priceUpdateAccount: PublicKey | null = null;
  await txb.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
    // The builder keys the map as "0x" + feed id hex.
    priceUpdateAccount = getPriceUpdateAccount(`0x${FEED_ID}`);
    return [];
  });
  const txs = await txb.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 10_000,
    tightComputeBudget: true,
  });
  // Send directly: pyth's sendTransactions helper pulls in jito-ts, whose
  // bundled web3.js import chain breaks on modern Node. Sequential send,
  // confirmed, is fine on devnet.
  for (const { tx, signers } of txs) {
    tx.sign([ctx.wallet, ...signers]);
    const postSig = await ctx.connection.sendTransaction(tx, { skipPreflight: true });
    await ctx.connection.confirmTransaction(postSig, "confirmed");
    // confirmTransaction doesn't reject on program failure — a reverted
    // post leaves the PriceUpdateV2 account unowned and the settle tx
    // then dies on the validator's owner check (custom 6000). Bail here
    // and retry on the next tick instead.
    const postStatus = await ctx.connection.getSignatureStatuses([postSig], {
      searchTransactionHistory: true,
    });
    if (postStatus.value[0]?.err) {
      throw new Error(
        `price update post reverted on-chain: ${JSON.stringify(postStatus.value[0].err)} (${postSig})`
      );
    }
  }
  if (!priceUpdateAccount) throw new Error("price update account not captured");
  ctx.log(`posted price update at ${(priceUpdateAccount as PublicKey).toBase58()}`);

  // tx 2: the atomic proof-gated settle bundle.
  const resolveIx = buildResolveMarketIxFromOracle(
    pythOracle,
    ctx.wallet.publicKey,
    m.marketPda,
    statement,
    outcome,
    {
      priceUpdateAccount: priceUpdateAccount as PublicKey,
      feedId: FEED_ID,
      threshold: m.thresholdRaw,
      referenceTs: m.referenceTs,
      maxStalenessSeconds: MAX_STALENESS_SECONDS,
      observedPrice: price,
      observedConf: conf,
      observedPublishTime: publishTime,
    }
  );
  const settleIx = buildSettleFromProofIx(
    ctx.wallet.publicKey,
    m.marketPda,
    outcome === 0 ? "yes" : "no"
  );
  const attestIx = buildAttestVerificationIx(ctx.wallet.publicKey, m.marketPda);

  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash();
  const settleTx = new Transaction({
    feePayer: ctx.wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  });
  settleTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  settleTx.add(resolveIx, settleIx, attestIx);
  settleTx.sign(ctx.wallet);
  const sig = await ctx.connection.sendRawTransaction(settleTx.serialize(), { skipPreflight: true });
  await ctx.connection.confirmTransaction(sig, "confirmed");
  // confirmTransaction does NOT reject on program failure — check meta.
  const status = await ctx.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const err = status.value[0]?.err;
  if (err) throw new Error(`settle tx failed on-chain: ${JSON.stringify(err)} (${sig})`);
  ctx.log(`settled ${m.marketPda.toBase58()} (proof-gated, pyth): ${sig}`);
  ctx.tracked.delete(m.marketPda.toBase58());
  ctx.onSettled?.(m, {
    signature: sig,
    outcome: outcome === 0 ? "yes" : "no",
    statement,
    observedPrice: price,
    observedPublishTime: publishTime,
  });
  return "settled";
}

// ── Attested price settle (PRICE_ORACLE=attestation) ────────────────
//
// Same proof-gated bundle the sports attestation keeper drives, with
// the price observation sourced from Coinbase's public minute candles
// (free, unauthenticated, permanent history). Trust model: the keeper's
// pinned attestor key signs {fixtureRef, statKey, value, obsTs}; the
// attestation validator verifies the ed25519 signature and the
// value >= threshold claim inside the resolve CPI. No Pyth dependency.

let cachedAttestor: Keypair | null = null;
let attestationConfigChecked = false;

async function settlePriceMarketAttested(
  ctx: PythMarketContext,
  m: TrackedPriceMarket,
  statement: string,
  nowSec: number
): Promise<PriceSettleResult> {
  const obs = await fetchSpotUsdAt(m.referenceTs).catch((e) => {
    ctx.log(`coinbase fetch failed for ${m.marketPda.toBase58()}: ${e}`);
    return null;
  });
  if (!obs) {
    // Coinbase publishes the reference candle minutes after the bucket
    // closes — a laggy fetch is NOT a source gap, because unlike Pyth's
    // publish_time the observation we sign is timestamped at signing
    // and the claim window is sized to it. Stay pending until just
    // inside the void grace; only a bucket Coinbase never publishes is
    // truly unresolvable.
    if (nowSec > m.referenceTs + PRICE_VOID_GRACE_SECONDS - 300) {
      ctx.log(
        `no coinbase candle for ${m.marketPda.toBase58()} at ${new Date(m.referenceTs * 1000).toISOString()} — unresolvable`
      );
      return "unresolvable";
    }
    return "pending";
  }
  const price = BigInt(Math.round(obs.usd * 10 ** -FEED_EXPO));
  const outcome = price >= m.thresholdRaw ? 0 : 1;
  ctx.log(
    `settling ${m.marketPda.toBase58()}: ${statement} observed=$${obs.usd} ` +
      `(coinbase ${obs.bucketTs} close) -> ${outcome === 0 ? "YES" : "NO"}`
  );
  if (ctx.dryRun) {
    ctx.tracked.delete(m.marketPda.toBase58());
    return "settled";
  }

  cachedAttestor ??= loadAttestor();
  if (!attestationConfigChecked) {
    await ensureAttestationConfig({
      connection: ctx.connection,
      wallet: ctx.wallet,
      attestor: cachedAttestor,
      dryRun: ctx.dryRun,
      onLog: ctx.log,
    });
    attestationConfigChecked = true;
  }

  const obsTs = Math.floor(Date.now() / 1000);
  const observation = {
    fixtureRef: fixtureRefForPriceMarket(m.predicate.matchId),
    statKey: ATTEST_STAT_KEYS.price_usd_e8,
    value: price,
    obsTs,
  };
  const message = buildAttestationMessage(observation);
  // The window only bounds how late the signed observation may arrive —
  // size it to actual elapsed time so backlog markets still settle.
  const claim = {
    op: ATTESTATION_OPS.gte,
    threshold: m.thresholdRaw,
    referenceTs: m.referenceTs,
    windowSeconds: Math.max(600, obsTs - m.referenceTs + 300),
  };
  const bundle = buildSettlementBundle(
    { wallet: ctx.wallet, attestor: cachedAttestor },
    m.marketPda,
    statement,
    outcome,
    observation,
    claim,
    message
  );
  const sig = await sendAndConfirm(
    { connection: ctx.connection, wallet: ctx.wallet },
    bundle,
    "settle bundle"
  );
  ctx.log(`settled ${m.marketPda.toBase58()} (proof-gated, operator-attested): ${sig}`);
  ctx.tracked.delete(m.marketPda.toBase58());
  ctx.onSettled?.(m, {
    signature: sig,
    outcome: outcome === 0 ? "yes" : "no",
    statement,
    observedPrice: price,
    observedPublishTime: obsTs,
  });
  return "settled";
}

/**
 * Void a market that can never produce a proof (no in-window Pyth
 * observation). void_market is permissionless once closes_at + the
 * program's 1h grace has passed; stakers are refunded by the program.
 */
export async function voidPriceMarket(
  ctx: PythMarketContext,
  m: TrackedPriceMarket
): Promise<void> {
  ctx.tracked.delete(m.marketPda.toBase58());
  if (ctx.dryRun) {
    ctx.log(`dry-run: would void ${m.marketPda.toBase58()} (${m.predicate.matchId})`);
    return;
  }
  const ix = buildVoidMarketIx(ctx.wallet.publicKey, m.marketPda);
  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: ctx.wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(ix);
  tx.sign(ctx.wallet);
  const sig = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await ctx.connection.confirmTransaction(sig, "confirmed");
  const status = await ctx.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (status.value[0]?.err) {
    throw new Error(`void tx failed on-chain: ${JSON.stringify(status.value[0].err)} (${sig})`);
  }
  ctx.log(`voided ${m.marketPda.toBase58()} (${m.predicate.matchId}): ${sig}`);
  ctx.onVoided?.(m, sig);
}

export interface PriceKeeperConfig {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  /** Market duration in seconds; markets close on round boundaries. */
  intervalSeconds: number;
  onLog?: (msg: string) => void;
  onSettled?: (m: TrackedPriceMarket, fact: PriceSettleFact) => void;
  onVoided?: (m: TrackedPriceMarket, signature: string | null) => void;
  /** Emitted once per sweep pass that reclaimed anything (batched — a
   *  backlog sweep is one ledger line, not hundreds). */
  onBondSweep?: (claimed: { marketPda: string; matchId: string; signature: string }[]) => void;
}

/** Interval markets: `${SYMBOL}:<referenceTs>` — numeric suffix only. */
export function isIntervalMatchId(matchId: string): boolean {
  return new RegExp(`^${PRICE_SYMBOL}:\\d+$`).test(matchId);
}

export async function runPriceKeeper(config: PriceKeeperConfig): Promise<void> {
  const log = (msg: string) => {
    console.log(`[price-keeper] ${msg}`);
    config.onLog?.(msg);
  };
  const ctx: PythMarketContext = {
    connection: config.connection,
    wallet: config.wallet,
    dryRun: config.dryRun,
    log,
    tracked: new Map(),
    onSettled: config.onSettled,
    onVoided: config.onVoided,
  };

  // Boot: recover markets created by a previous keeper run.
  await recoverOpenPriceMarkets(ctx, isIntervalMatchId).catch((e) => log(`recovery scan failed: ${e}`));

  // Boot + periodic bond sweep: reclaim the creator bond on every settled/
  // voided market this wallet created — the historical backlog on first run,
  // then anything any keeper misses (claims are in-memory elsewhere; this
  // sweep reads chain state). Without it each market strands its bond and
  // the wallet starves (~0.03 SOL/hr at 30-min intervals).
  const sweep = () =>
    sweepCreatorBonds({
      connection: ctx.connection,
      wallet: ctx.wallet,
      dryRun: ctx.dryRun,
      log,
    })
      .then((r) => {
        if (r.claimed.length > 0) config.onBondSweep?.(r.claimed);
      })
      .catch((e) => log(`bond sweep failed: ${e}`));
  await sweep();
  let lastSweep = Date.now();
  const SWEEP_EVERY_MS = 15 * 60 * 1000;

  const intervalMs = config.intervalSeconds * 1000;
  let hermesFailStreak = 0;
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const nextBoundary = now - (now % config.intervalSeconds) + config.intervalSeconds;
    // Isolated: a Hermes/create hiccup must not starve the settle pass —
    // that's what orphaned the Oct 1 backlog (creates ~3h apart, zero
    // settle attempts, OPEN markets piling up).
    try {
      await ensurePriceMarket(ctx, {
        matchId: `${PRICE_SYMBOL}:${nextBoundary}`,
        referenceTs: nextBoundary,
      });
      hermesFailStreak = 0;
    } catch (e) {
      hermesFailStreak++;
      const msg = String(e);
      log(
        `create tick failed (streak ${hermesFailStreak}): ${msg}` +
          (hermesFailStreak >= 5 && /Hermes (401|403)/.test(msg)
            ? " — PYTH_API_KEY has been failing repeatedly; check the terminal trial key"
            : "")
      );
    }

    for (const m of [...ctx.tracked.values()]) {
      if (now < m.referenceTs) continue;
      try {
        const result = await settlePriceMarket(ctx, m);
        if (
          (result === "unresolvable" || result === "unsupported") &&
          now > m.referenceTs + PRICE_VOID_GRACE_SECONDS
        ) {
          await voidPriceMarket(ctx, m);
        }
        hermesFailStreak = 0;
      } catch (e) {
        const msg = String(e);
        log(`settle failed for ${m.marketPda.toBase58()}: ${msg}`);
        if (/Hermes (401|403)/.test(msg)) hermesFailStreak++;
      }
    }
    if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = Date.now();
      await sweep();
    }
    await new Promise((r) => setTimeout(r, Math.min(intervalMs / 6, 30_000)));
  }
}
