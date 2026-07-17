/**
 * init-protocol — one-time devnet bootstrap.
 *
 * Calls initialize_protocol(fee_bps=25) to create ProtocolConfig + the
 * treasury PDA. Idempotent: re-running after the first success will skip
 * (the account already exists).
 *
 * Uses @stoppage/sdk for all instruction building + PDA derivation (rule 6).
 *
 * Usage: npx tsx scripts/init-protocol.ts
 */

import * as fs from "fs";
import {
  Connection,
  Keypair,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  findProtocolConfigPda,
  findTreasuryPda,
  buildInitializeProtocolIx,
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

  const [configPda] = findProtocolConfigPda();
  const [treasuryPda] = findTreasuryPda();
  const FEE_BPS = 25; // 0.25%

  console.log("Market program:", MARKET_PROGRAM_ID);
  console.log("Authority:    ", walletKeypair.publicKey.toBase58());
  console.log("Config PDA:   ", configPda.toBase58());
  console.log("Treasury PDA: ", treasuryPda.toBase58());
  console.log("Fee bps:      ", FEE_BPS, "(0.25%)");

  // Check if already initialized.
  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    console.log("\nProtocolConfig already exists — skipping (already initialized).");
    return;
  }

  const ix = buildInitializeProtocolIx(walletKeypair.publicKey, FEE_BPS);

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
  console.log("\nSent initialize_protocol tx:", sig);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("Confirmed!");

  // Verify.
  const config = await connection.getAccountInfo(configPda);
  if (config) {
    console.log("ProtocolConfig account created. Size:", config.data.length, "bytes");
  } else {
    console.log("ERROR: ProtocolConfig account not found after tx.");
  }
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
