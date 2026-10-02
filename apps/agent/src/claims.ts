/**
 * Creator-bond sweep — reclaims the refundable bond on every settled or
 * voided market this wallet created.
 *
 * Why this exists: every keeper process (interval price, week, live
 * sports) pays a creation bond, but each process's own claim logic only
 * ever covered its in-memory `tracked`/`knownMarketPdas` set — anything
 * missed (process restart, claim tx failing mid-loop, a process with no
 * claim path at all) stranded the bond in the market PDA forever. The
 * price keeper shipped that way and bled ~0.03 SOL/hr until the wallet
 * starved.
 *
 * The sweep is the floor underneath all of that: it reads chain state,
 * not process memory, so it recovers both the historical backlog and
 * anything any keeper misses going forward. Idempotent — bondClaimed is
 * checked on-chain per market.
 *
 * Positions are NOT claimed here: keepers don't take positions on
 * price/prop markets, and position claims are handled by each keeper's
 * own post-settle pass.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  buildClaimBondIx,
  parseMarket,
  MARKET_ACCOUNT_SIZE,
  MARKET_PROGRAM_ID,
} from "@stoppage/sdk";
import type { Market } from "@stoppage/sdk";

export interface BondSweepResult {
  scanned: number;
  claimed: { marketPda: string; matchId: string; signature: string }[];
  failed: { marketPda: string; error: string }[];
}

/** Every settled/void market created by `wallet` with an unclaimed bond. */
export async function findUnclaimedBonds(
  connection: Connection,
  wallet: PublicKey
): Promise<{ marketPda: PublicKey; market: Market }[]> {
  // Creator field offset: 8 (disc) + 1 (kind) + 32 (match vault) + 8 + 8
  // (yes/no pools) — same layout recoverOpenPriceMarkets filters on.
  const accounts = await connection.getProgramAccounts(
    new PublicKey(MARKET_PROGRAM_ID),
    {
      filters: [
        { dataSize: MARKET_ACCOUNT_SIZE },
        { memcmp: { offset: 8 + 1 + 32 + 8 + 8, bytes: wallet.toBase58() } },
      ],
    }
  );
  const out: { marketPda: PublicKey; market: Market }[] = [];
  for (const { account, pubkey } of accounts) {
    const m = parseMarket(account.data, pubkey.toBase58());
    if ((m.status === "settled" || m.status === "void") && !m.bondClaimed) {
      out.push({ marketPda: pubkey, market: m });
    }
  }
  return out;
}

const CLAIMS_PER_TX = 8;

/**
 * Claim every outstanding creator bond. Runs as its own transaction per
 * batch — one bad market must not strand the rest.
 */
export async function sweepCreatorBonds(ctx: {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  log: (msg: string) => void;
}): Promise<BondSweepResult> {
  const pending = await findUnclaimedBonds(ctx.connection, ctx.wallet.publicKey);
  const result: BondSweepResult = { scanned: pending.length, claimed: [], failed: [] };
  if (pending.length === 0) return result;

  ctx.log(`bond sweep: ${pending.length} unclaimed creator bond(s)`);
  if (ctx.dryRun) {
    for (const { marketPda, market } of pending) {
      ctx.log(`  dry-run: would claim ${marketPda.toBase58()} (${market.predicate.matchId})`);
    }
    return result;
  }

  for (let i = 0; i < pending.length; i += CLAIMS_PER_TX) {
    const batch = pending.slice(i, i + CLAIMS_PER_TX);
    try {
      const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash();
      const tx = new Transaction({
        feePayer: ctx.wallet.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ...batch.map(({ marketPda }) => buildClaimBondIx(ctx.wallet.publicKey, marketPda))
      );
      tx.sign(ctx.wallet);
      const sig = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await ctx.connection.confirmTransaction(sig, "confirmed");
      const status = await ctx.connection.getSignatureStatuses([sig], {
        searchTransactionHistory: true,
      });
      if (status.value[0]?.err) {
        throw new Error(`tx failed on-chain: ${JSON.stringify(status.value[0].err)} (${sig})`);
      }
      for (const { marketPda, market } of batch) {
        ctx.log(`bond claimed ${marketPda.toBase58()} (${market.predicate.matchId}): ${sig}`);
        result.claimed.push({ marketPda: marketPda.toBase58(), matchId: market.predicate.matchId, signature: sig });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const { marketPda } of batch) {
        result.failed.push({ marketPda: marketPda.toBase58(), error: msg });
      }
      ctx.log(`bond sweep batch failed (${msg}) — will retry next pass`);
    }
  }
  return result;
}
