import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from "@solana/web3.js";
import { buildJoinViaWalletIx } from "@stoppage/sdk";

const market = process.argv[2];
const side = (process.argv[3] ?? "yes") as "yes" | "no";
const lamports = Number(process.argv[4] ?? 5_000_000);

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
);
const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");

async function main() {
  const ix = buildJoinViaWalletIx(wallet.publicKey, new PublicKey(market), side, lamports);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (status.value[0]?.err) throw new Error(JSON.stringify(status.value[0].err));
  console.log(`joined ${side.toUpperCase()} ${lamports / 1e9} SOL: ${sig}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
