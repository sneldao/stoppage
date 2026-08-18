#!/usr/bin/env node
/**
 * prep-epl-keystone — derive + (optionally) pre-open the Aug 21 EPL
 * keystone market for the first staked settle.
 *
 * Arsenal v Coventry (EPL comp 8) is the target for M2 acceptance. This
 * mirrors the keeper's exact MLS/EPL template (total_goals_over, threshold
 * 3, TxLINE oracle) so the deterministic PDA matches what stoppage-agent
 * adopts at kickoff — creating it early is idempotent (dedup).
 *
 * Usage:
 *   npx tsx scripts/prep-epl-keystone.ts            # derive + print, no tx
 *   npx tsx scripts/prep-epl-keystone.ts --create   # create on-chain, then print
 *
 * Env: devnet wallet key (deployer), SOLANA_RPC_URL. TxLINE creds optional
 * (only needed to fetch the fixture by id — hardcoded default below).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  buildCreateMarketIx,
  DEFAULT_ORACLE,
  findMarketPdaFromPredicate,
  PREDICATE_KIND,
  type MarketPredicate,
} from "@stoppage/sdk";
import { loadCredentials, matchIdFromFixture, fetchFixture, type Fixture } from "@stoppage/txline";

const CLI: Record<string, string | undefined> = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  CLI[raw.slice(2, eq === -1 ? undefined : eq)] = eq === -1 ? "true" : raw.slice(eq + 1);
}
const create = CLI.create === "true" || process.argv.includes("--create");
const fixtureId = Number(CLI.fixture ?? 18146819);
const threshold = Number(CLI.threshold ?? 3);
const WALLET_PATH = process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

const log = (...m: unknown[]) => console.log("[prep-epl]", ...m);

async function main() {
  const { network, creds } = loadCredentials();
  const fixture = await fetchFixture(network, creds, fixtureId);
  if (!fixture) throw new Error(`fixture ${fixtureId} not found`);

  const matchId = matchIdFromFixture(fixture);
  const kickoffMs = Number((fixture as unknown as Record<string, unknown>).StartTime ?? 0);
  const closesAtSec = Math.floor(kickoffMs / 1000) + 2 * 3600;

  const predicate: MarketPredicate = {
    kind: "total_goals_over",
    matchId,
    params: { team: "", threshold },
  };
  const [pda] = findMarketPdaFromPredicate(predicate);

  log(`fixture #${fixture.FixtureId} ${fixture.Participant1} v ${fixture.Participant2}`);
  log(`matchId: ${matchId}`);
  log(`predicate: total_goals_over threshold=${threshold} oracle=${DEFAULT_ORACLE.toBase58()}`);
  log(`kickoff= ${new Date(kickoffMs).toISOString()} closesAt= ${new Date(closesAtSec * 1000).toISOString()}`);
  log(`market PDA: ${pda.toBase58()}`);

  const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const exists = await connection.getAccountInfo(pda);
  log(`on-chain: ${exists ? "EXISTS" : "not created yet"}`);

  if (!create) return;

  if (exists) {
    log("already on-chain — nothing to do (idempotent)");
    return;
  }
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const ix = buildCreateMarketIx({ creator: wallet.publicKey, predicate, closesAt: closesAtSec, oracle: DEFAULT_ORACLE });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ix
  );
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const st = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (st.value[0]?.err) throw new Error(`create failed: ${JSON.stringify(st.value[0].err)}`);
  log(`created market: ${sig}`);
  log(`explorer: https://explorer.solana.com/address/${pda.toBase58()}?cluster=devnet`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });