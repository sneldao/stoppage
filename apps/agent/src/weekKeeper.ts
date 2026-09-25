/**
 * Settled Week keeper — the weekly Pyth window market.
 *
 * Every week the keeper opens one named SOL/USD window market
 * (`SOL/USD:W<isoYear>-<isoWeek>`, line = spot at creation, i.e. the
 * Friday-open anchor) closing Sunday 23:00 UTC, settles it through the
 * exact proof-gated Pyth path the interval keeper uses (priceKeeper
 * primitives — same resolve -> settle -> attest bundle), then reclaims the
 * creation bond and its own position. Each settlement lands as a
 * `settlement_confirmed` fact in the shared match-events ledger and, most
 * importantly, on-chain: the chain is the cumulative Settled Week record.
 *
 * Restart-safe: open week markets are recovered by scanning kind=price_above
 * accounts for this wallet, filtered to the week matchId shape so the
 * interval keeper's markets are left alone (both keepers share a wallet).
 *
 * Usage:
 *   npx tsx apps/agent/src/index.ts week --live-tx [--delta=0]
 *
 * Environment: same as price mode (SOLANA_KEYPAIR_PATH, SOLANA_RPC_URL,
 * HERMES_URL, PYTH_API_KEY, PRICE_FEED_ID, PRICE_SYMBOL).
 */

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildClaimBondIx,
  buildClaimIx,
  buildVoidMarketIx,
  findPositionPda,
  getMarket,
  PYTH_VALIDATOR_PROGRAM_ID,
} from "@stoppage/sdk";
import type { MatchEventLedger } from "./eventLedger";
import {
  PRICE_SYMBOL,
  ensurePriceMarket,
  recoverOpenPriceMarkets,
  settlePriceMarket,
  type PythMarketContext,
  type TrackedPriceMarket,
} from "./priceKeeper";

/** Weekly settlement facts: `SOL/USD:W2026-39` (never numeric refs). */
export function isWeekMatchId(matchId: string): boolean {
  return /^W\d{4}-\d{2}$/.test(matchId.split(":")[1] ?? "");
}

export interface WeekWindow {
  label: string;
  matchId: string;
  closeTs: number;
}

/** ISO-8601 week number + iso year for the week containing `d`. */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/**
 * The active week window: closes on the next Sunday `closeHourUtc`:00
 * strictly after `nowSec`. Creation happens as soon as the keeper runs
 * (threshold = spot at creation = the open anchor).
 */
export function weekWindowFor(nowSec: number, closeHourUtc = 23): WeekWindow {
  const now = new Date(nowSec * 1000);
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
  sunday.setUTCHours(closeHourUtc, 0, 0, 0);
  if (sunday.getTime() <= now.getTime()) sunday.setUTCDate(sunday.getUTCDate() + 7);
  const { year, week } = isoWeek(sunday);
  const label = `W${year}-${String(week).padStart(2, "0")}`;
  return { label, matchId: `${PRICE_SYMBOL}:${label}`, closeTs: Math.floor(sunday.getTime() / 1000) };
}

export interface WeekKeeperConfig {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  /** Optional USD offset on the line vs spot at creation. */
  deltaUsd?: number;
  ledger?: MatchEventLedger;
  onLog?: (msg: string) => void;
}

/** void_market is permissionless after closes_at + 1h program grace. */
const VOID_GRACE_SECONDS = 3600 + 900;

export async function runWeekKeeper(config: WeekKeeperConfig): Promise<void> {
  const log = (msg: string) => {
    console.log(`[week-keeper] ${msg}`);
    config.onLog?.(msg);
  };
  const appendLedger = (event: Parameters<MatchEventLedger["append"]>[0]) => {
    try {
      config.ledger?.append(event);
    } catch (e) {
      log(`ledger append failed: ${e}`);
    }
  };

  let settledWindow: string | null = null;

  const ctx: PythMarketContext = {
    connection: config.connection,
    wallet: config.wallet,
    dryRun: config.dryRun,
    log,
    tracked: new Map(),
    onSettled: (m, fact) => {
      settledWindow = m.predicate.matchId;
      const thresholdUsd = Math.round(Number(m.thresholdRaw) * 1e-8);
      appendLedger({
        occurredAt: Date.now(),
        kind: "settlement_confirmed",
        label: `${PRICE_SYMBOL} week ${m.predicate.matchId.split(":")[1]}: above $${thresholdUsd} -> ${fact.outcome.toUpperCase()}`,
        matchId: m.predicate.matchId,
        marketId: m.marketPda.toBase58(),
        signature: fact.signature,
        source: "pyth",
        outcome: fact.outcome,
        oracle: PYTH_VALIDATOR_PROGRAM_ID,
        statement: fact.statement,
      });
      void claimReceipts(m);
    },
  };

  async function sendOne(ix: ReturnType<typeof buildClaimBondIx>): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await config.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: config.wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(config.wallet);
    const sig = await config.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await config.connection.confirmTransaction(sig, "confirmed");
    const status = await config.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    if (status.value[0]?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(status.value[0].err)} (${sig})`);
    return sig;
  }

  /** Post-settlement housekeeping: creator bond + the keeper's own position. */
  async function claimReceipts(m: TrackedPriceMarket) {
    const marketPk = m.marketPda;
    const onChain = await getMarket(config.connection, marketPk).catch((e) => {
      log(`post-settle market read failed: ${e}`);
      return null;
    });
    if (!onChain) return;

    if (onChain.status === "settled" || onChain.status === "void") {
      // Drop from tracking — settlement was recorded by this or an earlier run.
      ctx.tracked.delete(marketPk.toBase58());
    }

    if (
      onChain.creator === config.wallet.publicKey.toBase58() &&
      !onChain.bondClaimed &&
      (onChain.status === "settled" || onChain.status === "void") &&
      !config.dryRun
    ) {
      try {
        const sig = await sendOne(buildClaimBondIx(config.wallet.publicKey, marketPk));
        log(`bond claimed ${sig}`);
        appendLedger({
          occurredAt: Date.now(),
          kind: "bond_claimed",
          label: "week: creator bond claimed",
          matchId: m.predicate.matchId,
          marketId: marketPk.toBase58(),
          signature: sig,
          source: "pyth",
        });
      } catch (e) {
        log(`bond claim failed: ${e}`);
      }
    }

    const [position] = findPositionPda(marketPk, config.wallet.publicKey);
    const held = await config.connection.getAccountInfo(position);
    if (held && !config.dryRun && (onChain.status === "settled" || onChain.status === "void")) {
      try {
        const sig = await sendOne(buildClaimIx(config.wallet.publicKey, marketPk));
        log(`position claimed ${sig}`);
        appendLedger({
          occurredAt: Date.now(),
          kind: "claim_refund",
          label: "week: keeper position claimed",
          matchId: m.predicate.matchId,
          marketId: marketPk.toBase58(),
          signature: sig,
          source: "pyth",
        });
      } catch (e) {
        log(`position claim failed: ${e}`);
      }
    }
  }

  /** A window the keeper was down through can never settle (the validator
   *  rejects observations outside [close, close+staleness]) — void it so the
   *  loop rolls on; stakers are refunded by the program on void. */
  async function voidStale(m: TrackedPriceMarket) {
    settledWindow = m.predicate.matchId;
    ctx.tracked.delete(m.marketPda.toBase58());
    if (!config.dryRun) {
      try {
        const sig = await sendOne(buildVoidMarketIx(config.wallet.publicKey, m.marketPda));
        log(`voided stale window ${m.predicate.matchId}: ${sig}`);
        appendLedger({
          occurredAt: Date.now(),
          kind: "market_voided",
          label: `week: ${m.predicate.matchId} voided (settle window missed while keeper was down)`,
          matchId: m.predicate.matchId,
          marketId: m.marketPda.toBase58(),
          signature: sig,
          source: "pyth",
        });
      } catch (e) {
        log(`void failed: ${e}`);
        return;
      }
    }
    await claimReceipts(m);
  }

  await recoverOpenPriceMarkets(ctx, isWeekMatchId).catch((e) => log(`recovery scan failed: ${e}`));
  for (const m of [...ctx.tracked.values()]) {
    const onChain = await getMarket(config.connection, m.marketPda).catch(() => null);
    if (onChain && onChain.status !== "open") {
      settledWindow = m.predicate.matchId;
      await claimReceipts(m);
    }
  }

  for (;;) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const win = weekWindowFor(now);

      if (settledWindow !== win.matchId && !ctx.tracked.size) {
        const m = await ensurePriceMarket(ctx, {
          matchId: win.matchId,
          referenceTs: win.closeTs,
          deltaUsd: config.deltaUsd ?? 0,
        });
        if (m) {
          const onChain = await getMarket(config.connection, m.marketPda).catch(() => null);
          if (onChain && onChain.status !== "open") {
            // Settled/voided by an earlier run — record, don't re-settle.
            settledWindow = win.matchId;
            await claimReceipts(m);
          }
        }
      }

      for (const m of [...ctx.tracked.values()]) {
        if (now < m.referenceTs) continue;
        if (now > m.referenceTs + VOID_GRACE_SECONDS) {
          await voidStale(m);
        } else {
          await settlePriceMarket(ctx, m);
        }
      }
    } catch (e) {
      log(`tick error: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
