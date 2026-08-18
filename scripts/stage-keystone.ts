#!/usr/bin/env node
/**
 * stage-keystone — place the two opposing stakes on the real Aug 21
 * keystone market (Arsenal v Coventry) so M2 acceptance has liquidity.
 *
 * Deployer -> YES, opponent (secrets/demo-opponent-keypair.json) -> NO.
 * Idempotent (skips a side already staked); funds the opponent if short.
 * On matchday the keeper settles from the TxLINE proof; the winner claims;
 * the vault drains to zero — that ticks M2.
 *
 * Usage:
 *   npx tsx scripts/stage-keystone.ts                          # both sides
 *   npx tsx scripts/stage-keystone.ts --side=yes --lamports=10000000
 * Env: SOLANA_KEYPAIR_PATH (deployer) · KE_KEYSTONE_STAKE (lamports)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { buildJoinViaWalletIx, findPositionPda } from "@stoppage/sdk";

const ARGS: Record<string, string | undefined> = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  ARGS[raw.slice(2, eq === -1 ? undefined : eq)] = eq === -1 ? "true" : raw.slice(eq + 1);
}

const MARKET = ARGS.market ?? "F1qU5vZ6ssoK3t8hJzoKcnXuGBEjKrm4G3JQbfN97QEj";
const STAKE = Number(ARGS.lamports ?? process.env.KE_KEYSTONE_STAKE ?? 10_000_000); // 0.01 SOL each
const sideOnly = ARGS.side as "yes" | "no" | undefined;
const OPPONENT_PATH = path.join(process.cwd(), "secrets", "demo-opponent-keypair.json");
const walletPath = process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

const log = (...m: unknown[]) => console.log("[stage-keystone]", ...m);
const readKp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const deployer = readKp(walletPath);
  const opponent = readKp(OPPONENT_PATH);
  const market = new PublicKey(MARKET);
  if (!(await connection.getAccountInfo(market))) throw new Error(`market ${MARKET} not on-chain yet`);

  log(`market ${MARKET}`);
  log(`deployer(YES) ${deployer.publicKey.toBase58()} · opponent(NO) ${opponent.publicKey.toBase58()}`);

  async function join(kp: Keypair, sideStr: "yes" | "no") {
    if (sideOnly && sideStr !== sideOnly) return;
    const [pos] = findPositionPda(market, kp.publicKey);
    if (await connection.getAccountInfo(pos)) {
      log(`${sideStr} already staked by ${kp.publicKey.toBase58().slice(0, 8)} — skip`);
      return;
    }
    const ix = buildJoinViaWalletIx(kp.publicKey, market, sideStr, STAKE);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(kp);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction(sig, "confirmed");
    const st = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    if (st.value[0]?.err) throw new Error(`${sideStr} join failed: ${JSON.stringify(st.value[0].err)}`);
    log(`staked ${sideStr.toUpperCase()} ${STAKE / 1e9} SOL (${kp.publicKey.toBase58().slice(0, 8)}) :: ${sig}`);
  }

  async function fund(kp: Keypair, minLamports: number) {
    const bal = await connection.getBalance(kp.publicKey);
    if (bal >= minLamports) return;
    const need = minLamports - bal;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: deployer.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: kp.publicKey, lamports: need })
    );
    tx.sign(deployer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction(sig, "confirmed");
    log(`funded ${kp.publicKey.toBase58().slice(0, 8)} +${need / 1e9} SOL :: ${sig}`);
  }

  if (!sideOnly || sideOnly === "no") await fund(opponent, STAKE + 2_000_000);
  await join(deployer, "yes");
  if (!sideOnly || sideOnly === "no") await join(opponent, "no");
  log("Done — both sides seeded; keeper settles on matchday.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });