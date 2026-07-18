/**
 * create-proof-board-demo — create a small resolved devnet market so the
 * public proof board has real on-chain activity to display.
 *
 * This uses:
 * - deployer wallet: SOLANA_KEYPAIR_PATH, ANCHOR_WALLET, or ~/.config/solana/id.json
 * - opponent wallet: secrets/demo-opponent-keypair.json (created locally, gitignored)
 * - TxLINE devnet proof: fixture 17952170, seq 941, statKey 1002
 *
 * Usage: npx tsx scripts/create-proof-board-demo.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  buildAttestVerificationIx,
  buildClaimIx,
  buildCreateMarketIx,
  buildJoinViaWalletIx,
  buildResolveMarketIx,
  buildSettleFromProofIx,
  buildValidateStatData,
  deriveDailyScoresRootsPda,
  findMarketPdaFromPredicate,
  getMarket,
  type MarketPredicate,
} from "@stoppage/sdk";
import {
  TXLINE_CONFIG,
  epochDayFromTimestamp,
  fetchStatValidation,
  loadCredentials,
  normalizeProof,
  toBytes32,
} from "@stoppage/txline";

const DEMO_FIXTURE_ID = 17952170;
const DEMO_SEQ = 941;
const DEMO_STAT_KEY = 1002;
const THRESHOLD = 0;
const STAKE_LAMPORTS = 5_000_000; // 0.005 SOL per side
const OPPONENT_MIN_LAMPORTS = 30_000_000;

function configuredWalletPath() {
  return process.env.SOLANA_KEYPAIR_PATH
    ?? process.env.ANCHOR_WALLET
    ?? path.join(process.env.HOME ?? "", ".config", "solana", "id.json");
}

function readKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")))
  );
}

function loadOrCreateOpponent(): Keypair {
  const filePath = path.join(process.cwd(), "secrets", "demo-opponent-keypair.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(filePath)) return readKeypair(filePath);

  const keypair = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return keypair;
}

async function sendAndConfirm(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[]
) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

async function fundOpponentIfNeeded(connection: Connection, payer: Keypair, opponent: Keypair) {
  const balance = await connection.getBalance(opponent.publicKey);
  if (balance >= OPPONENT_MIN_LAMPORTS) return null;

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: opponent.publicKey,
      lamports: OPPONENT_MIN_LAMPORTS - balance,
    })
  );
  return sendAndConfirm(connection, tx, [payer]);
}

async function main() {
  const walletPath = configuredWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Solana keypair not found at ${walletPath}`);
  }

  const payer = readKeypair(walletPath);
  const opponent = loadOrCreateOpponent();
  const { network, creds } = loadCredentials();
  const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  const connection = new Connection(
    rpcUrl && !rpcUrl.includes("YOUR_API_KEY") ? rpcUrl : clusterApiUrl("devnet"),
    "confirmed"
  );

  const existingMarketAddress = process.env.DEMO_MARKET_ADDRESS;
  const suffix = Math.floor(Date.now() / 1000).toString(36).toUpperCase();
  const predicate: MarketPredicate = {
    kind: "total_goals_over",
    matchId: `DEMO-${suffix}`,
    params: { team: "", threshold: THRESHOLD },
  };
  const [derivedMarket] = findMarketPdaFromPredicate(predicate);
  const market = existingMarketAddress
    ? new PublicKey(existingMarketAddress)
    : derivedMarket;

  console.log("payer", payer.publicKey.toBase58());
  console.log("opponent", opponent.publicKey.toBase58());
  console.log("market", market.toBase58());

  if (!existingMarketAddress) {
    const fundSig = await fundOpponentIfNeeded(connection, payer, opponent);
    if (fundSig) console.log("fundOpponentTx", fundSig);

    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const createAndJoinSig = await sendAndConfirm(
      connection,
      new Transaction().add(
        buildCreateMarketIx({ creator: payer.publicKey, predicate, closesAt }),
        buildJoinViaWalletIx(payer.publicKey, market, "yes", STAKE_LAMPORTS)
      ),
      [payer]
    );
    console.log("createAndJoinTx", createAndJoinSig);

    const opponentJoinSig = await sendAndConfirm(
      connection,
      new Transaction().add(
        buildJoinViaWalletIx(opponent.publicKey, market, "no", STAKE_LAMPORTS)
      ),
      [opponent]
    );
    console.log("opponentJoinTx", opponentJoinSig);
  } else {
    const current = await getMarket(connection, market);
    console.log("resumeStatus", current.status);
    console.log("resumeOutcome", current.outcome);
  }

  const proof = await fetchStatValidation(network, creds, DEMO_FIXTURE_ID, DEMO_SEQ, DEMO_STAT_KEY);
  const statProof = normalizeProof(proof.statProof);
  const fixtureProof = normalizeProof(proof.subTreeProof);
  const mainTreeProof = normalizeProof(proof.mainTreeProof);
  const eventStatRoot = toBytes32(proof.eventStatRoot);
  const subTreeRoot = toBytes32(proof.summary.eventStatsSubTreeRoot);
  const txlineProgramId = new PublicKey(TXLINE_CONFIG[network].programId);
  const epochDay = epochDayFromTimestamp(proof.summary.updateStats.minTimestamp);
  const [dailyScoresRoots] = deriveDailyScoresRootsPda(txlineProgramId, epochDay);

  if (proof.statToProve.value <= THRESHOLD) {
    throw new Error(`Expected proof stat value > ${THRESHOLD}; got ${proof.statToProve.value}`);
  }

  const txlineIxData = buildValidateStatData({
    ts: proof.summary.updateStats.minTimestamp,
    fixtureSummary: {
      fixtureId: proof.summary.fixtureId,
      updateStats: proof.summary.updateStats,
      eventsSubTreeRoot: subTreeRoot,
    },
    fixtureProof,
    mainTreeProof,
    predicate: {
      threshold: THRESHOLD,
      comparison: 0, // GreaterThan
    },
    statA: {
      statToProve: {
        key: proof.statToProve.key,
        value: proof.statToProve.value,
        period: proof.statToProve.period ?? 0,
      },
      eventStatRoot,
      statProof,
    },
    statB: null,
    op: null,
  });

  const settleSig = await sendAndConfirm(
    connection,
    new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      buildResolveMarketIx(
        payer.publicKey,
        market,
        txlineProgramId,
        dailyScoresRoots,
        `Demo proof fixture ${DEMO_FIXTURE_ID} seq ${DEMO_SEQ} stat ${DEMO_STAT_KEY}`,
        eventStatRoot,
        0,
        txlineIxData
      ),
      buildSettleFromProofIx(payer.publicKey, market, "yes"),
      buildAttestVerificationIx(payer.publicKey, market)
    ),
    [payer]
  );
  console.log("settleTx", settleSig);

  const claimSig = await sendAndConfirm(
    connection,
    new Transaction().add(buildClaimIx(payer.publicKey, market)),
    [payer]
  );
  console.log("winnerClaimTx", claimSig);

  const settled = await getMarket(connection, market);
  console.log("status", settled.status);
  console.log("outcome", settled.outcome);
  console.log("verifications", settled.verifications);
  console.log("explorer", `https://explorer.solana.com/address/${market.toBase58()}?cluster=devnet`);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
