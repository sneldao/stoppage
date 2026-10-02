/**
 * sweep-bonds — reclaim every outstanding creator bond for a wallet.
 *
 * Any settled/voided market where the wallet is the creator and
 * bondClaimed is still false gets a claim_bond. Idempotent — safe to
 * re-run. Operators can use it for their own desk keypair too.
 *
 *   npx tsx scripts/sweep-bonds.ts <keypair.json>
 *   npx tsx scripts/sweep-bonds.ts <keypair.json> --dry-run
 */

import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import { findUnclaimedBonds, sweepCreatorBonds } from "../apps/agent/src/claims";

async function main() {
  const keypairPath = process.argv[2];
  if (!keypairPath) {
    console.error("usage: npx tsx scripts/sweep-bonds.ts <keypair.json> [--dry-run]");
    process.exit(1);
  }
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
  const dryRun = process.argv.includes("--dry-run");
  const connection = new Connection(
    process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
    "confirmed"
  );
  const log = (m: string) => console.log(`[sweep] ${m}`);

  const bal = await connection.getBalance(wallet.publicKey);
  console.log(`wallet ${wallet.publicKey.toBase58()} — ${bal / 1e9} SOL`);

  const pending = await findUnclaimedBonds(connection, wallet.publicKey);
  console.log(`${pending.length} settled/void market(s) with unclaimed bond`);
  if (pending.length === 0) return;

  const res = await sweepCreatorBonds({ connection, wallet, dryRun, log });
  console.log(
    `${dryRun ? "would claim" : "claimed"}: ${res.claimed.length}, failed: ${res.failed.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
