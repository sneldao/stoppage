/**
 * One-off verification: rebuild the settle ixs for the real fixture that
 * failed at 1281 > 1232 (BEA-EAG-18041427) and confirm the v0/ALT path
 * packs it under the packet limit. Creates the shared settle ALT on
 * devnet if it doesn't exist yet (real tx, ~0.007 SOL from the demo
 * wallet). Run: npx tsx scripts/_verify-settle.ts
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  fetchHistoricalScores,
  loadCredentials,
  TXLINE_CONFIG,
} from "@stoppage/txline";
import { findMarketPdaFromPredicate } from "@stoppage/sdk";
import { buildSettleFromProofIxs, buildSettleTransactions } from "../apps/agent/src/settle";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("secrets/demo-opponent-beta-keypair.json", "utf8"))
    )
  );
  console.log("wallet:", wallet.publicKey.toBase58());
  console.log("balance:", (await connection.getBalance(wallet.publicKey)) / 1e9, "SOL");

  const { network, creds } = loadCredentials();
  const fixtureId = 18041427; // BEA-EAG — the settle that failed 14x at 1281B
  const matchId = "BEA-EAG-18041427";

  // find the final seq — the last record in the fixture's history
  const history = (await fetchHistoricalScores(network, creds, fixtureId)) as unknown as {
    records?: Array<{ seq?: number; Seq?: number }>;
  } | Array<{ seq?: number }>;
  const records = Array.isArray(history) ? history : history.records ?? [];
  const seqs = records.map((r: any) => r.seq ?? r.Seq).filter((n: any) => Number.isFinite(n));
  const maxSeq = Math.max(...seqs);
  console.log(`history records: ${records.length}, max seq=${maxSeq}`);

  const predicate = {
    kind: "total_goals_over" as const,
    matchId,
    params: { team: "", threshold: 44, unit: "points" },
  };
  const [marketPda] = findMarketPdaFromPredicate(predicate);

  // stat-validation 500s on non-stat-bearing records (heartbeats) —
  // walk down from max seq to the last stat-bearing one.
  let built: Awaited<ReturnType<typeof buildSettleFromProofIxs>> | null = null;
  let seq = 0;
  for (seq = maxSeq; seq > maxSeq - 40 && seq > 0; seq--) {
    try {
      built = await buildSettleFromProofIxs({
        network,
        creds,
        fixtureId,
        seq,
        statKey: 1,
        statKey2: 2,
        threshold: 44,
        outcome: "yes",
        statement: `total_points_over:44:${matchId}`,
        marketPda,
        wallet: wallet.publicKey,
      });
      break;
    } catch (e) {
      // try the previous seq
    }
  }
  if (!built) throw new Error("no stat-bearing seq found near the tail");
  console.log(`using seq=${seq}`);
  console.log("proof:", built.proofSummary);

  const { txs, split } = await buildSettleTransactions(connection, wallet, built.instructions);
  console.log(`packed into ${txs.length} tx(s), split=${split}`);
  for (const [i, tx] of txs.entries()) {
    const raw = tx.serialize();
    console.log(`  tx[${i}]: ${raw.length} bytes (${raw.length <= 1232 ? "FITS" : "TOO BIG"})`);
  }

  // surface the ALT address for ops (SETTLE_ALT_ADDRESS on the VPS)
  try {
    const state = JSON.parse(fs.readFileSync(".runtime/settle-alt.json", "utf8"));
    console.log("settle ALT:", state.address);
    const info = await connection.getAddressLookupTable(new PublicKey(state.address));
    console.log("ALT on-chain:", !!info.value, "entries:", info.value?.state.addresses.length);
  } catch {
    console.log("no .runtime/settle-alt.json written (wasn't needed or creation failed)");
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
