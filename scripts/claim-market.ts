import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from "@solana/web3.js";
import { buildClaimIx, buildClaimBondIx } from "@stoppage/sdk";

const market = process.argv[2];

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
);
const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");

async function main() {
  const ix1 = buildClaimIx(wallet.publicKey, new PublicKey(market));
  const ix2 = buildClaimBondIx(wallet.publicKey, new PublicKey(market));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix1, ix2);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (status.value[0]?.err) throw new Error(JSON.stringify(status.value[0].err));
  console.log(`claimed + bond refunded: ${sig}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
