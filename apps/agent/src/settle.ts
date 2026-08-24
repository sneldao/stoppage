/**
 * Shared proof-gated settlement construction — the ONE implementation
 * of "fetch TxLINE proof → build resolve+settle instructions", used by
 * the live loop (loop.settleMarket) and the operator tool
 * (scripts/housekeep.ts). Rule 6: one implementation per concern.
 *
 * Two-stat totals: goals/corners markets prove BOTH team stats
 * (statKey + statKey2) and add them on-chain (op=Add), so the validated
 * predicate evaluates the same total the outcome was computed from.
 * Proving only one side makes away-heavy matches revert on YES.
 *
 * Transaction layout: compute budget + resolve_market + settle_from_proof.
 * attest_verification is a separate best-effort follow-up — with
 * two-stat proofs the bundle exceeds the 1232-byte tx size limit.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  buildAttestVerificationIx,
  buildResolveMarketIx,
  buildSettleFromProofIx,
  buildTxlineValidateStatData,
  deriveDailyScoresRootsPda,
  type Side,
} from "@stoppage/sdk";
import {
  epochDayFromTimestamp,
  fetchStatValidation,
  normalizeProof,
  toBytes32,
  TXLINE_CONFIG,
  type Network,
  type TxLineCredentials,
} from "@stoppage/txline";

export interface SettleProofArgs {
  network: Network;
  creds: TxLineCredentials;
  fixtureId: number;
  /** Score record seq (from an observed update, ≥1). */
  seq: number;
  statKey: number;
  /** Second stat key for total markets (P1+P2), added on-chain. */
  statKey2?: number;
  threshold: number;
  outcome: Side;
  /** Human-readable statement recorded in the resolution receipt. */
  statement: string;
  marketPda: PublicKey;
  wallet: PublicKey;
}

export interface SettleProofResult {
  /** compute budget + resolve_market + settle_from_proof */
  instructions: TransactionInstruction[];
  proofSummary: string;
  eventStatRoot: Uint8Array;
  epochDay: number;
}

export async function buildSettleFromProofIxs(
  args: SettleProofArgs
): Promise<SettleProofResult> {
  const proof = await fetchStatValidation(
    args.network,
    args.creds,
    args.fixtureId,
    args.seq,
    args.statKey,
    args.statKey2
  );

  const second =
    args.statKey2 !== undefined && proof.statToProve2 && proof.statProof2
      ? { stat: proof.statToProve2, proofNodes: proof.statProof2 }
      : null;
  const proofSummary = ` (proof: ${proof.statProof.length}${
    second ? `+${second.proofNodes.length}` : ""
  } stat nodes + ${proof.subTreeProof.length} subtree + ${
    proof.mainTreeProof.length
  } main, value=${proof.statToProve.value}${
    second ? `+${second.stat.value}` : ""
  })`;

  const eventStatRoot = toBytes32(proof.eventStatRoot);
  const subTreeRoot = toBytes32(proof.summary.eventStatsSubTreeRoot);
  const mapNodes = (nodes: ReturnType<typeof normalizeProof>) =>
    nodes.map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));

  const txlineProgramId = new PublicKey(TXLINE_CONFIG[args.network].programId);
  // Per TxLINE docs: derive epoch day from minTimestamp, not maxTimestamp
  const epochDay = epochDayFromTimestamp(proof.summary.updateStats.minTimestamp);
  const [dailyScoresRoots] = deriveDailyScoresRootsPda(txlineProgramId, epochDay);

  const statB = second
    ? {
        statToProve: {
          key: second.stat.key,
          value: second.stat.value,
          period: second.stat.period ?? 0,
        },
        eventStatRoot,
        statProof: mapNodes(normalizeProof(second.proofNodes)),
      }
    : null;

  const txlineIxData = buildTxlineValidateStatData({
    // Per TxLINE docs: ts = minTimestamp in milliseconds
    ts: proof.summary.updateStats.minTimestamp,
    fixtureSummary: {
      fixtureId: proof.summary.fixtureId,
      updateStats: {
        updateCount: proof.summary.updateStats.updateCount,
        minTimestamp: proof.summary.updateStats.minTimestamp,
        maxTimestamp: proof.summary.updateStats.maxTimestamp,
      },
      eventsSubTreeRoot: subTreeRoot,
    },
    fixtureProof: mapNodes(normalizeProof(proof.subTreeProof)),
    mainTreeProof: mapNodes(normalizeProof(proof.mainTreeProof)),
    // GreaterThan — "over" markets
    predicate: { threshold: args.threshold, comparison: 0 },
    statA: {
      statToProve: {
        key: proof.statToProve.key,
        value: proof.statToProve.value,
        period: proof.statToProve.period ?? 0,
      },
      eventStatRoot,
      statProof: mapNodes(normalizeProof(proof.statProof)),
    },
    statB,
    op: statB ? 0 : null, // Add when proving a P1+P2 total
  });

  const resolveIx = buildResolveMarketIx(
    args.wallet,
    args.marketPda,
    txlineProgramId,
    [dailyScoresRoots],
    args.statement,
    eventStatRoot,
    args.outcome === "yes" ? 0 : 1,
    txlineIxData
  );
  const settleIx = buildSettleFromProofIx(args.wallet, args.marketPda, args.outcome);

  return {
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      resolveIx,
      settleIx,
    ],
    proofSummary: `${proofSummary} [on-chain CPI via PDA epoch_day=${epochDay}]`,
    eventStatRoot,
    epochDay,
  };
}

/**
 * Best-effort attestation follow-up (permissionless verification
 * counter). Returns the signature, or null if it failed to land — the
 * market is already settled either way; anyone can attest later.
 */
export async function attestVerification(
  connection: Connection,
  wallet: Keypair,
  marketPda: PublicKey
): Promise<string | null> {
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(buildAttestVerificationIx(wallet.publicKey, marketPda));
    tx.sign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, "confirmed");
    // Confirmation doesn't surface program errors — check the status.
    const st = await connection.getSignatureStatuses([sig], {
      searchTransactionHistory: true,
    });
    if (st.value[0]?.err) return null;
    return sig;
  } catch {
    return null;
  }
}
