/**
 * claim-market — claim a position and/or the creator bond on a
 * settled/void market.
 *
 * Usage:
 *   npx tsx scripts/claim-market.ts <marketPda>
 *   npx tsx scripts/claim-market.ts <marketPda> --wallet=secrets/demo-opponent-keypair.json
 *   npx tsx scripts/claim-market.ts <marketPda> --no-bond      # position only
 *   npx tsx scripts/claim-market.ts <marketPda> --bond-only    # bond only
 *
 * Default wallet is the deployer (~/.config/solana/id.json). Loser-side
 * claims succeed with payout 0 (the program zeroes the position).
 */
import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from "@solana/web3.js";
import { buildClaimIx, buildClaimBondIx } from "@stoppage/sdk";

const ARGS: Record<string, string | undefined> = {};
const positional: string[] = [];
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) { positional.push(raw); continue; }
  const eq = raw.indexOf("=");
  ARGS[raw.slice(2, eq === -1 ? undefined : eq)] = eq === -1 ? "true" : raw.slice(eq + 1);
}
const market = positional[0];
const bondOnly = ARGS["bond-only"] === "true";
const noBond = ARGS["no-bond"] === "true";

const walletPath = ARGS.wallet ?? process.env.HOME + "/.config/solana/id.json";
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
);
const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");

async function main() {
  const mkt = new PublicKey(market);
  const before = await connection.getBalance(wallet.publicKey);
  const tx = new Transaction();
  if (!bondOnly) tx.add(buildClaimIx(wallet.publicKey, mkt));
  if (!noBond) tx.add(buildClaimBondIx(wallet.publicKey, mkt));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (status.value[0]?.err) throw new Error(JSON.stringify(status.value[0].err));
  const after = await connection.getBalance(wallet.publicKey);
  const net = (after - before) / 1e9;
  console.log(
    `${bondOnly ? "bond claimed" : noBond ? "position claimed" : "claimed + bond refunded"}: ${sig}` +
    ` · wallet ${wallet.publicKey.toBase58().slice(0, 8)} net ${net >= 0 ? "+" : ""}${net.toFixed(6)} SOL (after fee)`
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
