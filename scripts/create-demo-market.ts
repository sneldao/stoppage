/**
 * create-demo-market — create a sample in-play market on devnet for the demo.
 *
 * Uses @stoppage/sdk for all instruction building + PDA derivation (rule 6).
 *
 * Usage: npx tsx scripts/create-demo-market.ts
 */

import * as fs from "fs";
import {
  Connection,
  Keypair,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  buildCreateMarketIx,
  DEFAULT_ORACLE,
  type MarketPredicate,
} from "@stoppage/sdk";

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  const connection = new Connection(
    rpcUrl && !rpcUrl.includes("YOUR_API_KEY") ? rpcUrl : clusterApiUrl("devnet"),
    "confirmed"
  );

  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  // "Next goal within 600 seconds" for match FRA-ESP.
  const predicate: MarketPredicate = {
    kind: "next_goal_within",
    matchId: "FRA-ESP",
    params: { windowSeconds: 600 },
  };

  // Closes in 30 minutes — enough for the demo.
  const closesAt = Math.floor(Date.now() / 1000) + 1800;

  console.log("Creator:", walletKeypair.publicKey.toBase58());
  console.log("Predicate:", predicate.kind, "match:", predicate.matchId, "window:", predicate.params.windowSeconds, "s");
  console.log("Closes at:", new Date(closesAt * 1000).toISOString());

  const ix = buildCreateMarketIx({
    creator: walletKeypair.publicKey,
    predicate,
    closesAt,
    oracle: DEFAULT_ORACLE,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: walletKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(ix);
  tx.sign(walletKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  console.log("\nSent create_market tx:", sig);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("Confirmed!");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
