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
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  buildAttestVerificationIx,
  buildResolveMarketIx,
  buildSettleFromProofIx,
  buildTxlineValidateStatData,
  deriveDailyScoresRootsPda,
  MARKET_PROGRAM_ID,
  PYTH_RECEIVER_PROGRAM_ID,
  PYTH_VALIDATOR_PROGRAM_ID,
  SETTLEMENT_PROGRAM_ID,
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
 * Pack settle instructions into signed transactions that fit the
 * 1232-byte packet limit.
 *
 * One tx when the bundle fits. High-record fixtures (e.g. NFL, ~1900
 * updates) produce Merkle proofs that push past the limit — then the
 * bundle splits in two: [budget + resolve_market] then
 * [budget + settle_from_proof]. The resolution receipt is a persistent
 * on-chain PDA verified by settle_from_proof on read, so the proof gate
 * is identical either way.
 *
 * When even the split resolve tx exceeds the limit (BEA-EAG-18041427
 * failed 14× at 1281 > 1232 and had to be voided), the addresses that
 * are constant across every settle — program ids and the system
 * program — are pulled into a v0 address lookup table, saving ~31
 * bytes per resolved key. That band covers the observed oversized
 * proofs; a proof so deep it still won't fit needs the follow-up
 * proof-buffer account pattern.
 *
 * Callers send the returned transactions in order. Single shared
 * implementation — the keeper (loop.ts) and scripts/housekeep.ts both
 * settle through this.
 */
export async function buildSettleTransactions(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[]
): Promise<{ txs: (Transaction | VersionedTransaction)[]; split: boolean }> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const buildLegacy = (ixs: TransactionInstruction[]) => {
    const t = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    t.add(...ixs);
    t.sign(wallet);
    return t;
  };
  // serialize() throws "Transaction too large" past the packet limit on
  // legacy txs; v0 serialize() only enforces the limit on the message
  // buffer, so check the total byte length explicitly for both.
  const fits = (tx: Transaction | VersionedTransaction): boolean => {
    try {
      return tx.serialize().length <= PACKET_DATA_SIZE;
    } catch {
      return false;
    }
  };

  const single = buildLegacy(instructions);
  if (fits(single)) return { txs: [single], split: false };

  const [budgetIx, resolveIx, ...rest] = instructions;
  const parts = [
    [budgetIx, resolveIx],
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...rest],
  ];
  const legacies = parts.map(buildLegacy);
  if (legacies.every(fits)) return { txs: legacies, split: true };

  // v0 path. web3 compileToV0Message never looks up invoked program
  // ids — only non-signer account metas — so the wins come from the
  // per-settle addresses (market PDA, resolution PDA, daily roots…).
  // Ensure the table holds every candidate, wait for the extension to
  // activate, then recompile.
  const lut = await loadSettleAlt(connection, wallet).catch(() => null);
  if (!lut) {
    throw new Error(
      "settle tx exceeds the 1232-byte packet limit and the settle ALT is not usable yet — retry on the next tick"
    );
  }
  const invoked = new Set(instructions.map((ix) => ix.programId.toBase58()));
  const candidates = new Map<string, PublicKey>();
  for (const part of parts) {
    for (const ix of part) {
      for (const k of ix.keys) {
        const a = k.pubkey.toBase58();
        if (!k.isSigner && !invoked.has(a)) candidates.set(a, k.pubkey);
      }
    }
  }
  const ready = await ensureAltAddresses(
    connection,
    wallet,
    lut,
    [...candidates.values()]
  ).catch(() => null);
  if (!ready) {
    throw new Error(
      "settle tx exceeds the 1232-byte packet limit and the settle ALT extension is not active yet — retry on the next tick"
    );
  }

  // v0 txs serialize for the size check with zeroed signature
  // placeholders — sign() also serializes internally and would throw
  // on an oversized message before we could measure it. Sign only
  // after fits() passes.
  const buildV0 = (ixs: TransactionInstruction[]) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message([ready])
    );

  // Same bundle as a v0 tx — an atomic settle is preferred whenever the
  // lookup table shrinks it under the limit.
  const singleV0 = buildV0(instructions);
  if (fits(singleV0)) {
    singleV0.sign([wallet]);
    return { txs: [singleV0], split: false };
  }

  const txs: (Transaction | VersionedTransaction)[] = [];
  for (const [i, part] of parts.entries()) {
    const v0 = buildV0(part);
    if (fits(v0)) {
      v0.sign([wallet]);
      txs.push(v0);
      continue;
    }
    if (fits(legacies[i])) {
      txs.push(legacies[i]);
      continue;
    }
    throw new Error(
      "settle tx exceeds the 1232-byte packet limit even split + v0/LUT — proof too deep; needs a proof-buffer account"
    );
  }
  return { txs, split: true };
}

// ── Settle lookup table ─────────────────────────────────────────────
//
// Addresses that are identical in every settle bundle across every
// market and oracle. Compressing these out of the account-key list
// (~31 bytes each) buys headroom for oversized Merkle proofs without
// touching the programs.

const SETTLE_ALT_ADDRESSES: PublicKey[] = [
  SystemProgram.programId,
  ComputeBudgetProgram.programId,
  new PublicKey(MARKET_PROGRAM_ID),
  new PublicKey(SETTLEMENT_PROGRAM_ID),
  new PublicKey(PYTH_VALIDATOR_PROGRAM_ID),
  new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID),
  new PublicKey(PYTH_RECEIVER_PROGRAM_ID),
  new PublicKey(TXLINE_CONFIG.devnet.programId),
  new PublicKey(TXLINE_CONFIG.mainnet.programId),
];

function settleAltStatePath(): string {
  return path.join(process.cwd(), ".runtime", "settle-alt.json");
}

function rpcHost(connection: Connection): string {
  try {
    return new URL(connection.rpcEndpoint).hostname;
  } catch {
    return connection.rpcEndpoint;
  }
}

// Process-scoped pin: once we have a candidate table address, keep
// retrying that one instead of minting a new table per oversized
// settle attempt (each creation is real rent).
let pendingAlt: PublicKey | null = null;

/**
 * Load the keeper's settle ALT, creating + extending it on first use.
 * SETTLE_ALT_ADDRESS env overrides discovery (ops can point at a
 * known-good table without a creation cycle). Returns null when no
 * table is usable yet — freshly extended addresses activate on the
 * next slot — so callers always keep a working non-ALT path.
 */
async function loadSettleAlt(
  connection: Connection,
  wallet: Keypair
): Promise<AddressLookupTableAccount | null> {
  let address: PublicKey | null = null;
  const envAddr = process.env.SETTLE_ALT_ADDRESS;
  if (envAddr) {
    try {
      address = new PublicKey(envAddr);
    } catch {
      // invalid env value — ignore
    }
  }
  if (!address) {
    try {
      const stored = JSON.parse(fs.readFileSync(settleAltStatePath(), "utf8")) as {
        rpcHost?: string;
        address?: string;
      };
      if (stored.address && stored.rpcHost === rpcHost(connection)) {
        address = new PublicKey(stored.address);
      }
    } catch {
      // no state file yet
    }
  }
  if (!address && pendingAlt) address = pendingAlt;

  if (address) {
    pendingAlt = address;
    const res = await connection.getAddressLookupTable(address).catch(() => null);
    const table = res?.value ?? null;
    if (!table) return null; // not fetchable yet — retry next attempt
    const slot = await connection.getSlot("confirmed");
    // Extended addresses only resolve in slots after the extension.
    return slot > table.state.lastExtendedSlot ? table : null;
  }

  const recentSlot = await connection.getSlot("finalized");
  const [createIx, tableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: wallet.publicKey,
    payer: wallet.publicKey,
    recentSlot,
  });
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: wallet.publicKey,
    authority: wallet.publicKey,
    lookupTable: tableAddress,
    addresses: SETTLE_ALT_ADDRESSES,
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(createIx, extendIx);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");

  pendingAlt = tableAddress;
  const statePath = settleAltStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ rpcHost: rpcHost(connection), address: tableAddress.toBase58() }),
    "utf8"
  );
  // Not usable until the slot after the extension — next settle picks it up.
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure `lut` holds every address in `needed`, extending it (one tx,
 * keeper-signed) when it doesn't. Per-settle addresses — market PDA,
 * resolution PDA, daily roots — are the ones that actually compress:
 * invoked program ids are never looked up by compileToV0Message.
 * Returns the freshly fetched table once the extension is usable in a
 * later slot, or null to retry next tick. Rotates to a fresh table
 * when the current one can't absorb more addresses (256 max).
 */
async function ensureAltAddresses(
  connection: Connection,
  wallet: Keypair,
  lut: AddressLookupTableAccount,
  needed: PublicKey[]
): Promise<AddressLookupTableAccount | null> {
  const held = new Set(lut.state.addresses.map((a) => a.toBase58()));
  const missing = needed.filter((a) => !held.has(a.toBase58()));
  if (missing.length === 0) {
    const slot = await connection.getSlot("confirmed");
    return slot > lut.state.lastExtendedSlot ? lut : null;
  }
  if (lut.state.addresses.length + missing.length > 256) {
    // Table full — mint a fresh one seeded with the statics plus this
    // settle's dynamics. Not usable until a later slot; next tick
    // picks it up via loadSettleAlt.
    const recentSlot = await connection.getSlot("finalized");
    const [createIx, tableAddress] = AddressLookupTableProgram.createLookupTable({
      authority: wallet.publicKey,
      payer: wallet.publicKey,
      recentSlot,
    });
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: wallet.publicKey,
      authority: wallet.publicKey,
      lookupTable: tableAddress,
      addresses: [...SETTLE_ALT_ADDRESSES, ...needed],
    });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(createIx, extendIx);
    tx.sign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    pendingAlt = tableAddress;
    fs.writeFileSync(
      settleAltStatePath(),
      JSON.stringify({ rpcHost: rpcHost(connection), address: tableAddress.toBase58() }),
      "utf8"
    );
    return null;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: wallet.publicKey,
    authority: wallet.publicKey,
    lookupTable: lut.key,
    addresses: missing,
  });
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(extendIx);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");

  // Looked-up addresses resolve only in slots after lastExtendedSlot.
  const fresh = (await connection.getAddressLookupTable(lut.key)).value;
  if (!fresh) return null;
  for (let i = 0; i < 30; i++) {
    const slot = await connection.getSlot("confirmed");
    if (slot > fresh.state.lastExtendedSlot) return fresh;
    await sleep(400);
  }
  return null;
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
