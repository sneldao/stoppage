/**
 * Operator quickstart — the full proof-gated settlement loop as a
 * third party, end to end on devnet, SDK only.
 *
 *   1. keypair (yours — generated+persisted if absent)
 *   2. initialize_config: pin YOUR key as your attestor on the shared
 *      attestation validator (multi-tenant: seeds [b"config", you])
 *   3. create a `price_above` market bound to the attestation validator
 *   4. two wallets stake opposite sides (peer-funded vault)
 *   5. sign an observation of a real Coinbase SOL/USD minute candle
 *   6. one transaction: [ed25519 precompile, resolve_market CPI,
 *      settle_from_proof, attest_verification]
 *   7. winner claims from the vault; creator reclaims the bond
 *
 * Nothing here touches the house attestor or agent internals — the
 * settlement primitive verifies YOUR signature, atomically.
 *
 *   npx tsx scripts/operator-quickstart.ts
 */
import {
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "js-sha256";
import * as fs from "fs";
import * as path from "path";
import {
  ATTESTATION_OPS,
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  attestationOracle,
  buildAttestationMessage,
  buildClaimBondIx,
  buildClaimIx,
  buildAttestVerificationIx,
  buildCreateMarketIx,
  buildInitializeAttestationConfigIx,
  buildJoinViaWalletIx,
  buildResolveMarketIxFromOracle,
  buildSettleFromProofIx,
  deriveAttestationConfigPda,
  findMarketPdaFromPredicate,
  parseMarket,
} from "@stoppage/sdk";
import { fetchSpotUsdAt, fetchSpotUsdNow } from "../apps/agent/src/attest/coinbase";

const RPC = process.env.OPERATOR_RPC_URL ?? "https://api.devnet.solana.com";
const STAKE = 5_000_000; // 0.005 SOL a side
const RUNTIME = path.resolve(__dirname, "../.runtime");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadOrCreateKeypair(file: string): Keypair {
  const p = path.join(RUNTIME, file);
  fs.mkdirSync(RUNTIME, { recursive: true });
  if (fs.existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function fund(connection: Connection, kp: Keypair, need: number): Promise<void> {
  const bal = await connection.getBalance(kp.publicKey);
  if (bal >= need) return;
  console.log(`  requesting airdrop for ${kp.publicKey.toBase58()} (have ${bal / 1e9} SOL)`);
  const sig = await connection.requestAirdrop(kp.publicKey, 1e9);
  await connection.confirmTransaction(sig, "confirmed");
}

async function send(
  connection: Connection,
  signer: Keypair,
  ixs: TransactionInstruction[],
  label: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...ixs);
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const err = status.value[0]?.err;
  if (err) throw new Error(`${label} failed on-chain: ${JSON.stringify(err)} (${sig})`);
  console.log(`  ${label}: ${sig}`);
  return sig;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const operator = loadOrCreateKeypair("operator-quickstart.json");
  const bettor = loadOrCreateKeypair("operator-quickstart-bettor.json");
  console.log(`operator/attestor: ${operator.publicKey.toBase58()}`);
  console.log(`bettor:            ${bettor.publicKey.toBase58()}`);

  await fund(connection, operator, 0.08e9);
  await fund(connection, bettor, STAKE + 0.005e9);

  // ── 1. Pin your attestor key on the shared validator ────────────
  const validatorId = new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID);
  const [configPda] = deriveAttestationConfigPda(validatorId, operator.publicKey);
  if (!(await connection.getAccountInfo(configPda))) {
    console.log("initializing your attestation config…");
    await send(
      connection,
      operator,
      [buildInitializeAttestationConfigIx(operator.publicKey, operator.publicKey)],
      "initialize_config"
    );
  } else {
    console.log(`attestation config exists: ${configPda.toBase58()}`);
  }

  // ── 2. Create the market — bound to the attestation validator ───
  const now = Math.floor(Date.now() / 1000);
  const referenceTs = Math.floor(now / 60) * 60 + 120; // candle closing ~2min out
  const spot = await fetchSpotUsdNow();
  const thresholdUsd = Math.round(spot); // whole-dollar line
  const thresholdRaw = BigInt(thresholdUsd) * 100_000_000n; // e8 like the keeper
  const matchId = `OPERATOR-DEMO:${referenceTs}`;
  const statement = `sol_above:${thresholdUsd}:${referenceTs}`;
  const predicate = {
    kind: "price_above" as const,
    matchId,
    params: { team: "", threshold: Number(thresholdRaw) },
  };
  const [marketPda] = findMarketPdaFromPredicate(predicate);
  console.log(`market: "${statement}" → ${marketPda.toBase58()}`);
  if (!(await connection.getAccountInfo(marketPda))) {
    await send(
      connection,
      operator,
      [
        buildCreateMarketIx({
          creator: operator.publicKey,
          predicate,
          closesAt: referenceTs,
          oracle: validatorId,
        }),
      ],
      "create_market"
    );
  } else {
    const m = parseMarket((await connection.getAccountInfo(marketPda))!.data, marketPda.toBase58());
    if (m.status !== "open") {
      console.log(`market already ${m.status} — pick a new minute and rerun`);
      return;
    }
    console.log("market already exists — resuming");
  }

  // ── 3. Stake both sides (peer-funded vault) ─────────────────────
  const mInfo = await connection.getAccountInfo(marketPda);
  const parsed = mInfo ? parseMarket(mInfo.data, marketPda.toBase58()) : null;
  if (parsed && parsed.yesPool === 0) {
    await send(connection, operator, [buildJoinViaWalletIx(operator.publicKey, marketPda, "yes", STAKE)], "join YES 0.005");
    await send(connection, bettor, [buildJoinViaWalletIx(bettor.publicKey, marketPda, "no", STAKE)], "join NO 0.005");
  } else {
    console.log("positions already staked");
  }

  // ── 4. Wait for the reference candle, sign the observation ──────
  console.log(`waiting for the ${new Date(referenceTs * 1000).toISOString()} candle to close…`);
  let obs: Awaited<ReturnType<typeof fetchSpotUsdAt>> = null;
  while (!obs) {
    obs = await fetchSpotUsdAt(referenceTs);
    if (!obs) await sleep(10_000);
  }
  const value = BigInt(Math.round(obs.usd * 1e8));
  const outcome = value >= thresholdRaw ? 0 : 1;
  console.log(`observed $${obs.usd} (candle close ${obs.bucketTs}) → ${outcome === 0 ? "YES" : "NO"}`);

  const obsTs = Math.floor(Date.now() / 1000);
  const observation = {
    fixtureRef: new Uint8Array(sha256.array(`price:${matchId}`).slice(0, 16)),
    statKey: 1, // price_usd_e8 — the operator's stat registry is theirs
    value,
    obsTs,
  };
  const message = buildAttestationMessage(observation);
  const precompileIx = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: operator.secretKey, // YOU attest — your pinned key
    message,
  });
  const signature = new Uint8Array(precompileIx.data.subarray(16, 80));

  const resolveIx = buildResolveMarketIxFromOracle(
    attestationOracle,
    operator.publicKey,
    marketPda,
    statement,
    outcome,
    {
      ...observation,
      op: ATTESTATION_OPS.gte,
      threshold: thresholdRaw,
      referenceTs,
      windowSeconds: Math.max(600, obsTs - referenceTs + 300),
      authority: operator.publicKey,
      signature,
    }
  );
  const settleIx = buildSettleFromProofIx(operator.publicKey, marketPda, outcome === 0 ? "yes" : "no");
  const attestIx = buildAttestVerificationIx(operator.publicKey, marketPda);

  // ed25519 must IMMEDIATELY precede resolve_market — the validator
  // reads it from the instructions sysvar.
  const settleSig = await send(
    connection,
    operator,
    [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      precompileIx,
      resolveIx,
      settleIx,
      attestIx,
    ],
    "resolve+settle (proof-gated)"
  );

  const after = parseMarket((await connection.getAccountInfo(marketPda))!.data, marketPda.toBase58());
  console.log(`market ${after.status}, outcome=${after.outcome}, receipt on-chain in ${settleSig}`);

  // ── 5. Vault release: winner claims, creator reclaims bond ──────
  const winner = outcome === 0 ? operator : bettor;
  const balBefore = await connection.getBalance(winner.publicKey);
  await send(connection, winner, [buildClaimIx(winner.publicKey, marketPda)], "claim payout");
  const balAfter = await connection.getBalance(winner.publicKey);
  console.log(`winner ${winner.publicKey.toBase58()} claimed ${(balAfter - balBefore) / 1e9} SOL from the vault`);

  await send(connection, operator, [buildClaimBondIx(operator.publicKey, marketPda)], "claim bond");

  console.log("\ndone — created, staked, attested, proof-settled and paid out with your own key.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
