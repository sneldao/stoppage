#!/usr/bin/env node
/**
 * housekeep — idempotent market settlement/cleanup + claim housekeeper.
 *
 * Codifies the manual devnet runbook (2026-08-18) so stale markets get
 * resolved and bonds/refunds get reclaimed automatically. Reuses the SAME
 * SDK + TxLINE primitives as the live keeper (apps/agent/src/loop.ts) so
 * behavior matches the running agent.
 *
 * For each candidate market (from the match ledger, or passed explicitly):
 *   1. If open/awaiting and PAST closes_at + grace -> try to settle it
 *      (only when a TxLINE proof reference is supplied), else VOID it.
 *   2. If settled or void -> claim the creator bond and any position owned
 *      by the supplied wallet.
 *   3. Append each real action to the shared match-events ledger.
 *
 * Idempotent by construction: void is one-way after grace, and claim /
 * claim-bond on an already-claimed market is a benign no-op. Safe to run
 * on a schedule. Use --dry-run anywhere to preview without signing/fees.
 *
 * Usage:
 *   npx tsx scripts/housekeep.ts
 *   npx tsx scripts/housekeep.ts --market=<PDA>[,<PDA>...] --dry-run
 *   npx tsx scripts/housekeep.ts --wallet=./secrets/agent-devnet.json --min-stale-hours=8 --no-claim
 *   # settle a specific market from a TxLINE proof (else it voids):
 *   npx tsx scripts/housekeep.ts --settle --fixture=17615190 --seq=941 --stat-key=1 --outcome=no
 *
 * Safety: a market is only VOIDED once it is past closes_at + grace AND
 * `--min-stale-hours` (default 8h) after close — TxLINE proofs can land up
 * to ~8h after full-time, so a too-early void would steal a legitimate
 * settlement from the live keeper.
 *
 * Environment:
 *   SOLANA_RPC_URL    — RPC (default devnet public)
 *   MATCH_EVENTS_PATH — ledger path (default .runtime/match-events.ndjson)
 *   TXLINE creds      — optional; required for --settle (env or .txline-credentials.json)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  buildAttestVerificationIx,
  buildClaimBondIx,
  buildClaimIx,
  buildResolveMarketIx,
  buildSettleFromProofIx,
  buildTxlineValidateStatData,
  buildVoidMarketIx,
  deriveDailyScoresRootsPda,
  findPositionPda,
  parseMarket,
  type Market,
  type Side,
} from "@stoppage/sdk";
import {
  epochDayFromTimestamp,
  fetchStatValidation,
  loadCredentials,
  normalizeProof,
  toBytes32,
  TXLINE_CONFIG,
  type Network,
} from "@stoppage/txline";
import { MatchEventLedger } from "../apps/agent/src/eventLedger";

const GRACE_SECONDS_DEFAULT = 3600; // matches the 1h on-chain grace
const RPC_DEFAULT = clusterApiUrl("devnet");

// ── CLI ─────────────────────────────────────────────────────────────
const args: Record<string, string | undefined> = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  const name = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
  args[name] = eq === -1 ? "true" : raw.slice(eq + 1);
}
const flag = (name: string, def = false) => (name in args ? args[name] !== "false" : def);
const value = (name: string, def?: string) => args[name] ?? def;

const walletPath = value("wallet")
  ? path.resolve(value("wallet")!)
  : path.join(os.homedir(), ".config", "solana", "id.json");
const ledgerPath =
  process.env.MATCH_EVENTS_PATH ??
  value("ledger") ??
  path.resolve(process.cwd(), ".runtime", "match-events.ndjson");
const rpc = process.env.SOLANA_RPC_URL ?? value("rpc") ?? RPC_DEFAULT;
const graceSec = Math.max(0, Number(value("grace", String(GRACE_SECONDS_DEFAULT))) || GRACE_SECONDS_DEFAULT);
/** Do not void until this long after closes_at — proofs can land ~8h post-FT. */
const staleHours = Math.max(0, Number(value("min-stale-hours", "8")) || 8);
const doVoid = flag("void", true);
const doClaim = flag("claim", true);
const doSettle = flag("settle");
const dryRun = flag("dry-run");

const outFixture = args.fixture ? Number(args.fixture) : undefined;
const outSeq = args.seq ? Number(args.seq) : undefined;
const outStatKey = args.statKey ? Number(args.statKey) : undefined;
const outOutcome: Side | undefined = args.outcome === "yes" ? "yes" : args.outcome === "no" ? "no" : undefined;

const log = (...m: string[]) => console.log("[housekeep]", ...m);

function loadWallet(): Keypair {
  if (!fs.existsSync(walletPath)) throw new Error(`Wallet keypair not found: ${walletPath} (pass --wallet=<path>)`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
}

async function submit(
  connection: Connection,
  wallet: Keypair,
  ixs: TransactionInstruction[],
  label: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const st = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (st.value[0]?.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(st.value[0].err)} (${sig})`);
  return sig;
}

/** Errors we treat as "already handled" so a re-run is a clean no-op. */
function isBenign(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /BondAlreadyClaimed|NothingToClaim|NotPositionOwner|not owned by expected|account.*not.*found/i.test(s);
}

// ── Decision + actions ──────────────────────────────────────────────

/** The goals/window line a sports market was created with lands in param_u64. */
function marketThreshold(market: Market): number {
  const p = market.predicate.params as Record<string, unknown>;
  return Number(p.threshold ?? p.windowSeconds ?? 0) || 0;
}

/** Settle from a TxLINE Merkle proof — mirrors suspension loop.settleMarket. */
async function settleMarket(
  connection: Connection,
  wallet: Keypair,
  market: Market,
  marketPda: PublicKey
): Promise<string> {
  if (!(outFixture && outSeq && outStatKey && outOutcome)) {
    throw new Error("settle requires --fixture --seq --stat-key --outcome");
  }
  const network: Network = "devnet";
  const { network: credNetwork, creds } = loadCredentials();
  if (credNetwork !== network) throw new Error(`TxLINE creds are for ${credNetwork}, not ${network}`);

  const proof = await fetchStatValidation(network, creds, outFixture, outSeq, outStatKey);

  const statProof = normalizeProof(proof.statProof).map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));
  const subTree = normalizeProof(proof.subTreeProof).map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));
  const mainTree = normalizeProof(proof.mainTreeProof).map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));
  const eventStatRoot = toBytes32(proof.eventStatRoot);
  const subTreeRoot = toBytes32(proof.summary.eventStatsSubTreeRoot);

  const txlineId = new PublicKey(TXLINE_CONFIG[network].programId);
  const epochDay = epochDayFromTimestamp(proof.summary.updateStats.minTimestamp);
  const [dailyScoresRoots] = deriveDailyScoresRootsPda(txlineId, epochDay);

  const txlineIxData = buildTxlineValidateStatData({
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
    fixtureProof: subTree,
    mainTreeProof: mainTree,
    predicate: { threshold: marketThreshold(market), comparison: 0 },
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

  const resolveIx = buildResolveMarketIx(
    wallet.publicKey,
    marketPda,
    txlineId,
    [dailyScoresRoots],
    `${market.predicate.kind}:${outOutcome}:${market.predicate.matchId}`,
    eventStatRoot,
    outOutcome === "yes" ? 0 : 1,
    txlineIxData
  );
  const settleIx = buildSettleFromProofIx(wallet.publicKey, marketPda, outOutcome);
  const attestIx = buildAttestVerificationIx(wallet.publicKey, marketPda);
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  return submit(connection, wallet, [budget, resolveIx, settleIx, attestIx], "settle");
}

async function voidMarket(connection: Connection, wallet: Keypair, marketPda: PublicKey): Promise<string> {
  return submit(connection, wallet, [buildVoidMarketIx(wallet.publicKey, marketPda)], "void");
}

async function claimMarket(
  connection: Connection,
  wallet: Keypair,
  marketPda: PublicKey,
  ledger: MatchEventLedger,
  matchId: string
) {
  const marketRaw = await connection.getAccountInfo(marketPda);
  if (!marketRaw) return;
  let market: Market;
  try {
    market = parseMarket(marketRaw.data, marketPda.toBase58());
  } catch {
    return; // unknown layout — nothing to claim from here
  }
  if (market.status !== "settled" && market.status !== "void") return; // only after resolution

  // Creator bond (market.creator wallet only)
  if (market.creator === wallet.publicKey.toBase58() && !market.bondClaimed) {
    if (dryRun) { log(`  [dry] would claim bond on ${marketPda.toBase58()}`); }
    else {
      try {
        const sig = await submit(connection, wallet, [buildClaimBondIx(wallet.publicKey, marketPda)], "claim_bond");
        ledger.append({ occurredAt: Date.now(), kind: "bond_claimed", label: "created bond claimed", matchId, marketId: marketPda.toBase58(), source: "housekeep" });
        log(`claimed bond ${marketPda.toBase58()} :: ${sig}`);
      } catch (e) { if (!isBenign(e)) log(`bond claim failed ${marketPda.toBase58()}: ${e}`); }
    }
  }

  // Position owned by this wallet (refund on void, payout on settled)
  const [posPda] = findPositionPda(marketPda, wallet.publicKey);
  const posInfo = await connection.getAccountInfo(posPda);
  if (posInfo) {
    if (dryRun) { log(`[dry] would claim position on ${marketPda.toBase58()}`); }
    else {
      try {
        const sig = await submit(connection, wallet, [buildClaimIx(wallet.publicKey, marketPda)], "claim");
        ledger.append({ occurredAt: Date.now(), kind: "claim_refund", label: "claimed payout/refund", matchId, marketId: marketPda.toBase58(), source: "housekeep" });
        log(`claimed position ${marketPda.toBase58()} :: ${sig}`);
      } catch (e) { if (!isBenign(e)) log(`claim position failed ${marketPda.toBase58()}: ${e}`); }
    }
  }
}

// ── Candidate markets ───────────────────────────────────────────────

function marketsFromLedger(ledger: MatchEventLedger): string[] {
  const seen = new Set<string>();
  for (const ev of ledger.readEvents()) if (ev.marketId) seen.add(ev.marketId);
  return [...seen];
}

async function run() {
  const connection = new Connection(rpc, "confirmed");
  const wallet = loadWallet();
  const ledger = new MatchEventLedger(ledgerPath);

  log(`wallet ${wallet.publicKey.toBase58()} · rpc ${rpc}`);
  log(`grace=${graceSec}s stale≥${staleHours}h · void=${doVoid} claim=${doClaim} settle=${doSettle} dryRun=${dryRun}`);

  let markets = value("market") ? value("market")!.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (markets.length === 0) {
    markets = marketsFromLedger(ledger);
    log(`derived ${markets.length} market(s) from ledger ${ledgerPath}`);
  }
  if (markets.length === 0) {
    log("no markets. Pass --market=<PDA> or point at a ledger that has marketIds.");
    return;
  }

  for (const addr of markets) {
    const marketPda = new PublicKey(addr);
    const raw = await connection.getAccountInfo(marketPda);
    if (!raw) { log(`skip ${addr}: no account`); continue; }
    let market: Market;
    try {
      market = parseMarket(raw.data, addr);
    } catch (e) {
      log(`skip ${addr}: account not a readable Market (${raw.data.length}B) — ${e}`);
      continue;
    }
    const nowMs = Date.now();
    const closesMs = new Date(market.closesAt).getTime();
    const stale = closesMs + graceSec * 1000 + staleHours * 3600 * 1000 < nowMs;
    const unsettled = market.status === "open" || market.status === "awaiting_settlement";

    log(`# ${addr} · ${market.predicate.kind}:${market.predicate.matchId} · ${market.status} · closes ${market.closesAt}${stale ? " (STALE)" : ""}`);

    // 1) settle-or-void
    if (unsettled && stale) {
      let settledSig: string | null = null;
      if (doSettle) {
        try {
          settledSig = await settleMarket(connection, wallet, market, marketPda);
          log(`settled ${addr} :: ${settledSig}`);
          ledger.append({ occurredAt: Date.now(), kind: "settlement_confirmed", label: `settled from proof`, matchId: market.predicate.matchId, marketId: addr, source: "housekeep" });
        } catch (e) {
          log(`settle ${addr} failed (will void): ${e}`);
          settledSig = null;
        }
      }
      if (!settledSig && doVoid) {
        if (dryRun) { log(`  [dry] would VOID ${addr}`); }
        else {
          try {
            const sig = await voidMarket(connection, wallet, marketPda);
            ledger.append({ occurredAt: Date.now(), kind: "housekeep_void", label: "voided: settle unavailable / past grace", matchId: market.predicate.matchId, marketId: addr, source: "housekeep" });
            log(`voided ${addr} :: ${sig}`);
          } catch (e) { log(`void failed ${addr}: ${e}`); }
        }
      }
    }

    // 2) claim (sweeps settled/void markets; uses the fresh status after any action above)
    if (doClaim) {
      await claimMarket(connection, wallet, marketPda, ledger, market.predicate.matchId);
    }
  }
  log("done.");
}

run().then(() => process.exit(0)).catch((e) => { console.error("[housekeep] FATAL:", e); process.exit(1); });