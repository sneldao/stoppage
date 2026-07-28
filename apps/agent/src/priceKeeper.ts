/**
 * Price market keeper — the "oracle-agnostic" claim made operational.
 *
 * Runs an interval loop that creates `price_above` markets on a price feed
 * and settles them against a Pyth PriceUpdateV2 observation, using the same
 * resolve_market -> settle_from_proof -> attest_verification bundle the
 * TxLINE keeper uses. The settlement transaction still fails atomically if
 * the pyth_validator CPI rejects the observation, so fund release for a
 * price market is gated on the same proof receipt path as a sports market.
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
  buildAttestVerificationIx,
  buildCreateMarketIx,
  buildResolveMarketIxFromOracle,
  buildSettleFromProofIx,
  findMarketPdaFromPredicate,
  parseMarket,
  pythOracle,
  PYTH_FEED_IDS,
  MARKET_ACCOUNT_SIZE,
  MARKET_PROGRAM_ID,
  PYTH_VALIDATOR_PROGRAM_ID,
  type MarketPredicate,
} from "@stoppage/sdk";

const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network";
const FEED_ID = process.env.PRICE_FEED_ID ?? PYTH_FEED_IDS["SOL/USD"];
const SYMBOL = process.env.PRICE_SYMBOL ?? "SOL/USD";
const MAX_STALENESS_SECONDS = 120;
// Pyth majors carry expo -8 (price in 1e-8 USD).
const FEED_EXPO = -8;

interface HermesUpdate {
  binary: { data: string[] };
  parsed: Array<{
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }>;
}

async function fetchLatestUpdate(): Promise<HermesUpdate> {
  const res = await fetch(
    `${HERMES}/v2/updates/price/latest?ids[]=${FEED_ID}&encoding=base64&parsed=true`
  );
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as HermesUpdate;
  if (!j.parsed?.[0] || j.parsed[0].id !== FEED_ID) {
    throw new Error("Hermes returned no update for the feed");
  }
  return j;
}

/** Spot price in native units (i64), from Hermes. */
async function spotNative(): Promise<bigint> {
  const j = await fetchLatestUpdate();
  return BigInt(j.parsed[0].price.price);
}

export interface PriceKeeperConfig {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  /** Market duration in seconds; markets close on round boundaries. */
  intervalSeconds: number;
  onLog?: (msg: string) => void;
}

interface TrackedPriceMarket {
  predicate: MarketPredicate;
  marketPda: PublicKey;
  referenceTs: number;
  thresholdRaw: bigint;
}

export async function runPriceKeeper(config: PriceKeeperConfig): Promise<void> {
  const log = (msg: string) => {
    console.log(`[price-keeper] ${msg}`);
    config.onLog?.(msg);
  };
  const oraclePubkey = new PublicKey(PYTH_VALIDATOR_PROGRAM_ID);
  const tracked = new Map<string, TrackedPriceMarket>();

  /** Scan on-chain for our open price markets (restart recovery). */
  async function recoverOpenMarkets(): Promise<void> {
    const kindByte = 4; // price_above
    const accounts = await config.connection.getProgramAccounts(
      new PublicKey(MARKET_PROGRAM_ID),
      {
        filters: [
          { dataSize: MARKET_ACCOUNT_SIZE },
          // kind byte (price_above = 4); memcmp takes base58 — bs58(0x04) = "5"
          {
            memcmp: {
              offset: 8,
              bytes: "5",
            },
          },
          // creator
          {
            memcmp: {
              offset: 8 + 1 + 32 + 8 + 8,
              bytes: config.wallet.publicKey.toBase58(),
            },
          },
        ],
      }
    );
    for (const { account, pubkey } of accounts) {
      const m = parseMarket(account.data, pubkey.toBase58());
      if (m.status !== "open") continue;
      const refTs = Date.parse(m.closesAt) / 1000;
      // parseMarket stores the price threshold in params.threshold for
      // price_above markets (feed-native units).
      const thresholdRaw = BigInt(Number(m.predicate.params.threshold ?? 0));
      if (tracked.has(pubkey.toBase58())) continue;
      tracked.set(pubkey.toBase58(), {
        predicate: m.predicate,
        marketPda: pubkey,
        referenceTs: refTs,
        thresholdRaw,
      });
      log(`recovered open market ${pubkey.toBase58()} (ref ${new Date(refTs * 1000).toISOString()})`);
    }
  }

  async function ensureMarket(referenceTs: number): Promise<void> {
    const spot = await spotNative();
    // Round the threshold to whole USD so the statement is legible.
    const thresholdUsd = Number(spot) * 10 ** FEED_EXPO;
    const roundedUsd = Math.round(thresholdUsd);
    const thresholdRaw = BigInt(roundedUsd) * 10n ** BigInt(-FEED_EXPO);

    const predicate: MarketPredicate = {
      kind: "price_above",
      // The market PDA seeds don't include closes_at, so the round's
      // reference time must be part of match_id — otherwise every round
      // with the same threshold collides on the same PDA.
      matchId: `${SYMBOL}:${referenceTs}`,
      params: { team: "", threshold: Number(thresholdRaw) },
    };
    const [marketPda] = findMarketPdaFromPredicate(predicate);
    const pdaAddress = ******************();
    if (tracked.has(pdaAddress)) return;

    const existing = await config.connection.getAccountInfo(marketPda);
    if (existing) {
      log(`market already exists: ${pdaAddress}`);
      tracked.set(pdaAddress, { predicate, marketPda, referenceTs, thresholdRaw });
      return;
    }

    log(
      `creating market: ${SYMBOL} above $${roundedUsd} at ${new Date(referenceTs * 1000).toISOString()} (${pdaAddress})`
    );
    if (!config.dryRun) {
      const ix = buildCreateMarketIx({
        creator: config.wallet.publicKey,
        predicate,
        closesAt: referenceTs,
        oracle: oraclePubkey,
      });
      const { blockhash, lastValidBlockHeight } = await config.connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: config.wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix);
      tx.sign(config.wallet);
      const sig = await config.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await config.connection.confirmTransaction(sig, "confirmed");
      const status = await config.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
      if (status.value[0]?.err) throw new Error(`create tx failed on-chain: ${JSON.stringify(status.value[0].err)} (${sig})`);
      log(`market created, tx ${sig}`);
    }
    tracked.set(pdaAddress, { predicate, marketPda, referenceTs, thresholdRaw });
  }

  async function settleMarket(m: TrackedPriceMarket): Promise<void> {
    const statement = `sol_above:${Number(m.thresholdRaw) / 10 ** -FEED_EXPO}:${m.referenceTs}`;

    // Poll Hermes until an observation lands inside [ref, ref + staleness].
    let update: HermesUpdate | null = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const j = await fetchLatestUpdate();
      const publishTime = j.parsed[0].price.publish_time;
      if (publishTime >= m.referenceTs && publishTime <= m.referenceTs + MAX_STALENESS_SECONDS) {
        update = j;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!update) {
      log(`no observation inside window for ${m.marketPda.toBase58()}; will retry next tick`);
      return;
    }
    const price = BigInt(update.parsed[0].price.price);
    const conf = BigInt(update.parsed[0].price.conf);
    const publishTime = update.parsed[0].price.publish_time;
    const outcome = price >= m.thresholdRaw ? 0 : 1;
    log(
      `settling ${m.marketPda.toBase58()}: ${statement} observed=${price} (${publishTime}) -> ${outcome === 0 ? "YES" : "NO"}`
    );
    if (config.dryRun) {
      tracked.delete(m.marketPda.toBase58());
      return;
    }

    // tx 1: post the guardian-verified observation on-chain (ephemeral
    // PriceUpdateV2 account). Permissionless oracle plumbing.
    const receiver = new PythSolanaReceiver({
      connection: config.connection,
      wallet: new Wallet(config.wallet),
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
      tx.sign([config.wallet, ...signers]);
      const postSig = await config.connection.sendTransaction(tx, { skipPreflight: true });
      await config.connection.confirmTransaction(postSig, "confirmed");
    }
    if (!priceUpdateAccount) throw new Error("price update account not captured");
    log(`posted price update at ${(priceUpdateAccount as PublicKey).toBase58()}`);

    // tx 2: the atomic proof-gated settle bundle.
    const resolveIx = buildResolveMarketIxFromOracle(
      pythOracle,
      config.wallet.publicKey,
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
      config.wallet.publicKey,
      m.marketPda,
      outcome === 0 ? "yes" : "no"
    );
    const attestIx = buildAttestVerificationIx(config.wallet.publicKey, m.marketPda);

    const { blockhash, lastValidBlockHeight } = await config.connection.getLatestBlockhash();
    const settleTx = new Transaction({
      feePayer: config.wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    settleTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    settleTx.add(resolveIx, settleIx, attestIx);
    settleTx.sign(config.wallet);
    const sig = await config.connection.sendRawTransaction(settleTx.serialize(), { skipPreflight: true });
    await config.connection.confirmTransaction(sig, "confirmed");
    // confirmTransaction does NOT reject on program failure — check meta.
    const status = await config.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const err = status.value[0]?.err;
    if (err) throw new Error(`settle tx failed on-chain: ${JSON.stringify(err)} (${sig})`);
    log(`settled ${m.marketPda.toBase58()} (proof-gated, pyth): ${sig}`);
    tracked.delete(m.marketPda.toBase58());
  }

  // Boot: recover markets created by a previous keeper run.
  await recoverOpenMarkets().catch((e) => log(`recovery scan failed: ${e}`));

  const intervalMs = config.intervalSeconds * 1000;
  for (;;) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const nextBoundary = now - (now % config.intervalSeconds) + config.intervalSeconds;
      // Make sure both the current and next window have markets.
      await ensureMarket(nextBoundary);

      for (const m of [...tracked.values()]) {
        if (now >= m.referenceTs) {
          await settleMarket(m);
        }
      }
    } catch (e) {
      log(`tick error: ${e}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(intervalMs / 6, 30_000)));
  }
}
