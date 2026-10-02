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
 * checked on-chain per market, and closed accounts simply stop
 * appearing in the scan.
 *
 * Markets past the claims window (settles_at + MARKET_CLOSE_GRACE_SECONDS)
 * get close_market instead of claim_bond — one instruction returns the
 * account rent, the bond, and any residue, and the account stops
 * existing. Markets still inside the window get claim_bond only.
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
  buildCloseMarketIx,
  parseMarket,
  MARKET_ACCOUNT_SIZE,
  MARKET_CLOSE_GRACE_SECONDS,
  MARKET_PROGRAM_ID,
} from "@stoppage/sdk";
import type { Market } from "@stoppage/sdk";

export interface BondSweepResult {
  scanned: number;
  claimed: { marketPda: string; matchId: string; signature: string }[];
  closed: { marketPda: string; matchId: string; signature: string }[];
  failed: { marketPda: string; error: string }[];
}

export interface DeadMarket {
  marketPda: PublicKey;
  market: Market;
  /** Past the claims window — closable, rent + bond + residue recoverable. */
  closable: boolean;
}

/** Every settled/void market created by `wallet`, annotated with closability. */
export async function findDeadMarkets(
  connection: Connection,
  wallet: PublicKey
): Promise<DeadMarket[]> {
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
  const nowSec = Math.floor(Date.now() / 1000);
  const out: DeadMarket[] = [];
  for (const { account, pubkey } of accounts) {
    const m = parseMarket(account.data, pubkey.toBase58());
    if (m.status !== "settled" && m.status !== "void") continue;
    const settledSec = m.settlesAt ? Date.parse(m.settlesAt) / 1000 : 0;
    out.push({
      marketPda: pubkey,
      market: m,
      closable: settledSec > 0 && nowSec > settledSec + MARKET_CLOSE_GRACE_SECONDS,
    });
  }
  return out;
}

const CLAIMS_PER_TX = 8;

/**
 * Recover every outstanding creator balance. Markets past the claims
 * window get close_market (rent + bond + residue in one instruction);
 * markets still inside it get claim_bond. Runs as its own transaction
 * per batch — one bad market must not strand the rest.
 */
export async function sweepCreatorBonds(ctx: {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  log: (msg: string) => void;
}): Promise<BondSweepResult> {
  const dead = await findDeadMarkets(ctx.connection, ctx.wallet.publicKey);
  const closable = dead.filter((d) => d.closable);
  const bondOnly = dead.filter((d) => !d.closable && !d.market.bondClaimed);
  const result: BondSweepResult = {
    scanned: dead.length,
    claimed: [],
    closed: [],
    failed: [],
  };
  if (closable.length === 0 && bondOnly.length === 0) return result;

  ctx.log(
    `bond sweep: ${dead.length} dead market(s) — ${closable.length} closable, ${bondOnly.length} bond-only`
  );
  if (ctx.dryRun) {
    for (const { marketPda, market } of closable) {
      ctx.log(`  dry-run: would close ${marketPda.toBase58()} (${market.predicate.matchId})`);
    }
    for (const { marketPda, market } of bondOnly) {
      ctx.log(`  dry-run: would claim bond on ${marketPda.toBase58()} (${market.predicate.matchId})`);
    }
    return result;
  }

  const sendBatch = async (
    batch: DeadMarket[],
    ixFor: (m: DeadMarket) => ReturnType<typeof buildClaimBondIx>,
    sink: BondSweepResult["claimed"] | BondSweepResult["closed"],
    verb: string
  ) => {
    for (let i = 0; i < batch.length; i += CLAIMS_PER_TX) {
      const chunk = batch.slice(i, i + CLAIMS_PER_TX);
      try {
        const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash();
        const tx = new Transaction({
          feePayer: ctx.wallet.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ...chunk.map(ixFor)
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
        for (const { marketPda, market } of chunk) {
          ctx.log(`${verb} ${marketPda.toBase58()} (${market.predicate.matchId}): ${sig}`);
          sink.push({ marketPda: marketPda.toBase58(), matchId: market.predicate.matchId, signature: sig });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        for (const { marketPda } of chunk) {
          result.failed.push({ marketPda: marketPda.toBase58(), error: msg });
        }
        ctx.log(`bond sweep batch failed (${msg}) — will retry next pass`);
      }
    }
  };

  await sendBatch(
    closable,
    (d) => buildCloseMarketIx(ctx.wallet.publicKey, d.marketPda),
    result.closed,
    "market closed"
  );
  await sendBatch(
    bondOnly,
    (d) => buildClaimBondIx(ctx.wallet.publicKey, d.marketPda),
    result.claimed,
    "bond claimed"
  );
  return result;
}
