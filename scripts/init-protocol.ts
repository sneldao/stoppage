/**
 * init-protocol — one-time devnet bootstrap.
 *
 * Calls initialize_protocol(fee_bps=25) to create ProtocolConfig + the
 * treasury PDA, then converges the agent_authority PDA: creates it via
 * set_agent_authority (init_if_needed) when missing — deployments
 * initialized before that account existed can't otherwise create it —
 * or re-points it at AGENT_AUTHORITY / the positional arg.
 *
 * Uses @stoppage/sdk for all instruction building + PDA derivation (rule 6).
 *
 * Usage: npx tsx scripts/init-protocol.ts [agentAuthorityPubkey]
 */

import * as fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  MARKET_PROGRAM_ID,
  findProtocolConfigPda,
  findTreasuryPda,
  findAgentAuthorityPda,
  buildInitializeProtocolIx,
  buildSetAgentAuthorityIx,
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
  const [agentAuthorityPda] = findAgentAuthorityPda();
  const FEE_BPS = 25; // 0.25%

  // Heal target: which pubkey should hold agent authority when the PDA is
  // missing or being re-pointed. Positional arg or AGENT_AUTHORITY env;
  // defaults to the deployer wallet (matches initialize_protocol).
  const agentTarget = new PublicKey(
    process.argv[2] ?? process.env.AGENT_AUTHORITY ?? walletKeypair.publicKey
  );

  console.log("Market program:", MARKET_PROGRAM_ID);
  console.log("Authority:    ", walletKeypair.publicKey.toBase58());
  console.log("Config PDA:   ", configPda.toBase58());
  console.log("Treasury PDA: ", treasuryPda.toBase58());
  console.log("Agent PDA:    ", agentAuthorityPda.toBase58());
  console.log("Agent target: ", agentTarget.toBase58());
  console.log("Fee bps:      ", FEE_BPS, "(0.25%)");

  const send = async (ix: TransactionInstruction, label: string) => {
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
    console.log(`\nSent ${label} tx:`, sig);
    await connection.confirmTransaction(sig, "confirmed");
    const status = await connection.getSignatureStatus(sig);
    if (status.value?.err) throw new Error(`${label} reverted: ${JSON.stringify(status.value.err)}`);
    console.log("Confirmed!");
  };

  const existing = await connection.getAccountInfo(configPda);
  if (!existing) {
    await send(
      buildInitializeProtocolIx(walletKeypair.publicKey, FEE_BPS),
      "initialize_protocol"
    );
    const config = await connection.getAccountInfo(configPda);
    console.log(
      config
        ? `ProtocolConfig account created. Size: ${config.data.length} bytes`
        : "ERROR: ProtocolConfig account not found after tx."
    );
  } else {
    console.log("\nProtocolConfig already exists — skipping initialize.");
  }

  // Deployments initialized by a pre-agent-authority binary have a config
  // but no agent_authority PDA (attest_pricing then reverts with
  // AccountNotInitialized). set_agent_authority is init_if_needed and
  // heals this; re-pointing an existing authority is the same call.
  const agentAcct = await connection.getAccountInfo(agentAuthorityPda);
  const currentAuthority = agentAcct
    ? new PublicKey(agentAcct.data.subarray(8, 40)).toBase58()
    : null;
  if (currentAuthority === agentTarget.toBase58()) {
    console.log("AgentAuthority already set to target — done.");
    return;
  }
  await send(
    buildSetAgentAuthorityIx(walletKeypair.publicKey, agentTarget),
    "set_agent_authority"
  );
  const healed = await connection.getAccountInfo(agentAuthorityPda);
  console.log(
    healed
      ? `AgentAuthority PDA live. Size: ${healed.data.length} bytes`
      : "ERROR: AgentAuthority account not found after tx."
  );
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
