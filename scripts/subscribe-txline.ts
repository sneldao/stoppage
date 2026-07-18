/**
 * subscribe-txline — one-time TxLINE free-tier subscription on devnet.
 *
 * This script:
 *   1. Calls the TxLINE program's `subscribe` instruction on devnet
 *      (service level 1 = free World Cup tier, 4 weeks)
 *   2. Fetches a guest JWT from the TxLINE API
 *   3. Signs the activation message and activates the API token
 *   4. Saves credentials to .txline-credentials.json for the agent
 *
 * Prerequisites:
 *   - Funded devnet wallet at SOLANA_KEYPAIR_PATH, ANCHOR_WALLET, or
 *     ~/.config/solana/id.json (in that order)
 *   - npm install @solana/spl-token (already a dev dependency)
 *
 * Usage: npx tsx scripts/subscribe-txline.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  TXLINE_CONFIG,
  fetchGuestJwt,
  activateApiToken,
  type Network,
} from "@stoppage/txline";

// Load the TxLINE devnet IDL
const txoracleIdl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "packages", "txline", "idl", "txoracle-devnet.json"),
    "utf8"
  )
);

const NETWORK: Network = "devnet";
const SERVICE_LEVEL_ID = 1; // Free World Cup tier
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: number[] = []; // Standard bundle

function configuredWalletPath() {
  return process.env.SOLANA_KEYPAIR_PATH
    ?? process.env.ANCHOR_WALLET
    ?? path.join(process.env.HOME ?? "", ".config", "solana", "id.json");
}

async function main() {
  const config = TXLINE_CONFIG[NETWORK];
  const connection = new Connection(config.rpcUrl, "confirmed");

  // Load wallet
  const walletPath = configuredWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Solana keypair not found at ${walletPath}. Set SOLANA_KEYPAIR_PATH or ANCHOR_WALLET.`);
  }
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  console.log("=== TxLINE Free-Tier Subscription ===");
  console.log("Network:", NETWORK);
  console.log("Wallet:", walletKeypair.publicKey.toBase58());
  console.log("Service level:", SERVICE_LEVEL_ID, "(free World Cup)");
  console.log("Duration:", DURATION_WEEKS, "weeks");
  console.log();

  // Check balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("Wallet balance:", balance / 1e9, "SOL");
  if (balance < 0.05) {
    console.warn("WARNING: Low balance. Need SOL for tx fees + rent.");
  }

  // Set up Anchor provider with the keypair as wallet
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: walletKeypair.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(walletKeypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach((tx) => tx.partialSign(walletKeypair));
        return txs;
      },
    },
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const programId = new PublicKey(config.programId);
  const program = new anchor.Program(txoracleIdl, provider);

  // Verify IDL matches network
  if (!program.programId.equals(programId)) {
    throw new Error(
      `IDL program ${program.programId.toBase58()} != ${NETWORK} program ${programId.toBase58()}`
    );
  }

  // Derive PDAs
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );

  const txlTokenMint = new PublicKey(config.txlTokenMint);

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );

  const userTokenAccount = getAssociatedTokenAddressSync(
    txlTokenMint,
    walletKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("Derived PDAs:");
  console.log("  Token treasury:", tokenTreasuryPda.toBase58());
  console.log("  Pricing matrix:", pricingMatrixPda.toBase58());
  console.log("  User token acct:", userTokenAccount.toBase58());
  console.log();

  // Step 1: Create the user's TxL token account if it doesn't exist
  console.log("Step 1: Creating TxL token account (idempotent)...");
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    walletKeypair.publicKey,
    userTokenAccount,
    walletKeypair.publicKey,
    txlTokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const { blockhash: ataBlockhash, lastValidBlockHeight: ataLastValid } = await connection.getLatestBlockhash();
  const ataTx = new Transaction({
    feePayer: walletKeypair.publicKey,
    blockhash: ataBlockhash,
    lastValidBlockHeight: ataLastValid,
  }).add(createAtaIx);
  ataTx.sign(walletKeypair);

  const ataSig = await connection.sendRawTransaction(ataTx.serialize());
  await connection.confirmTransaction(ataSig, "confirmed");
  console.log("Token account ready:", ataSig);
  console.log();

  // Step 2: Subscribe on-chain
  console.log("Step 2: Subscribing on-chain...");
  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: walletKeypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Subscribe tx:", txSig);
  await connection.confirmTransaction(txSig, "confirmed");
  console.log("Confirmed!");
  console.log();

  // Step 3: Get guest JWT
  console.log("Step 3: Fetching guest JWT...");
  const jwt = await fetchGuestJwt(NETWORK);
  console.log("Guest JWT acquired.");
  console.log();

  // Step 4: Sign activation message + activate
  console.log("Step 4: Activating API token...");
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);

  // Sign with the keypair using tweetnacl (ed25519 detached signature)
  const signatureBytes = nacl.sign.detached(message, walletKeypair.secretKey);

  const apiToken = await activateApiToken(
    NETWORK,
    txSig,
    SELECTED_LEAGUES,
    jwt,
    async () => signatureBytes
  );

  console.log("API token activated!");
  console.log();

  // Step 5: Save credentials
  const credPath = path.join(__dirname, "..", ".txline-credentials.json");
  const credentials = {
    network: NETWORK,
    txSig,
    jwt,
    apiToken,
    walletPubkey: walletKeypair.publicKey.toBase58(),
    subscribedAt: new Date().toISOString(),
    serviceLevelId: SERVICE_LEVEL_ID,
    durationWeeks: DURATION_WEEKS,
  };

  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  // mode only applies on file creation; enforce it when refreshing credentials.
  fs.chmodSync(credPath, 0o600);
  console.log("Credentials saved to:", credPath, "(permissions: 600)");
  console.log();
  console.log("=== Subscription complete ===");
  console.log("The agent can now use these credentials to stream TxLINE data.");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
