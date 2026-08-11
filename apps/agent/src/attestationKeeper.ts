/**
 * Attestation keeper — proof-gated settlement of sports markets on
 * non-TxLINE data (MLS, Premier League, ...) via our OWN operator
 * attestation oracle. The third demonstration of the oracle-agnostic
 * settlement primitive, and the reference for "operators bring their
 * own oracles" (docs/ATTESTATION-ORACLE.md).
 *
 * Trust-model honesty: unlike the TxLINE keeper (Merkle proofs verified
 * by TxODDS's program) or the price keeper (Wormhole guardians), the
 * observation here is signed by ONE operator key pinned on-chain in the
 * attestation_validator Config PDA. The primitive's guarantee is
 * unchanged — fund release is cryptographically tied to an
 * ed25519-precompile-verified attestation IN THE SAME TRANSACTION —
 * but epistemic truth is 1-of-1 operator attestation. Demo copy must
 * say "operator-attested", never "verified by the network".
 *
 * One event per run (PM2 restarts per event). Flow:
 *   1. ensure the validator's Config PDA exists (first-init-wins) and
 *      matches the local attestor key
 *   2. create the market (total_goals_over:<line>, oracle =
 *      attestation_validator) unless it already exists
 *   3. poll TheSportsDB until the match finishes
 *   4. sign the observation, submit the atomic bundle:
 *      [compute budget, ed25519 precompile, resolve_market (CPI),
 *       settle_from_proof, attest_verification]
 *   5. exit
 *
 * Usage:
 *   npx tsx apps/agent/src/index.ts attest --event=<tsdbEventId> [--line=2] [--live-tx]
 *
 * Environment:
 *   SOLANA_KEYPAIR_PATH   — keeper wallet (pays bond + fees)
 *   ATTESTOR_KEYPAIR_PATH — operator signing key (default:
 *                           secrets/attestor-keypair.json, auto-generated)
 *   SOLANA_RPC_URL        — default https://api.devnet.solana.com
 *   THESPORTSDB_API_KEY   — default "3" (the public test key)
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  Ed25519Program,
} from "@solana/web3.js";
import {
  ATTESTATION_OPS,
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  attestationOracle,
  buildAttestationMessage,
  buildAttestVerificationIx,
  buildCreateMarketIx,
  buildInitializeAttestationConfigIx,
  buildResolveMarketIxFromOracle,
  buildSettleFromProofIx,
  deriveAttestationConfigPda,
  findMarketPdaFromPredicate,
  parseMarket,
  type MarketPredicate,
} from "@stoppage/sdk";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchEvent, type ObservedMatch } from "./attest/theSportsDB";
import { recordAction, withSpan } from "./telemetry";

// ── Stat-key registry (single source of truth for attestation claims) ─
// Opaque to the validator (bound into the signed message); new sports
// statistics add an entry here and a source mapping in the adapter.
export const ATTEST_STAT_KEYS = { total_goals: 1 } as const;

/** fixture_ref binding: sha256("tsdb:<eventId>")[..16]. */
export function fixtureRefForEvent(eventId: number): Uint8Array {
  return createHash("sha256").update(`tsdb:${eventId}`).digest().subarray(0, 16);
}

// Earliest plausible full-time is ~105 min after kickoff (90 + 15 HT +
// minimal stoppage); extra time stays inside the window.
const REFERENCE_OFFSET_SECONDS = 6_300; // kickoff + 105 min
const WINDOW_SECONDS = 14_400; // observation valid for 4 h after reference
const POLL_MS = 60_000;

export interface AttestationKeeperConfig {
  connection: Connection;
  wallet: Keypair; // keeper (pays)
  attestor: Keypair; // signs observations
  dryRun: boolean;
  eventId: number;
  /** Integer goal line: market settles YES iff total goals > line. */
  line: number;
  onLog?: (msg: string) => void;
}

function loadOrCreateAttestor(keypairPath: string): Keypair {
  if (fs.existsSync(keypairPath)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
    );
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export function loadAttestor(): Keypair {
  const defaultPath = path.resolve(__dirname, "../../../secrets/attestor-keypair.json");
  return loadOrCreateAttestor(process.env.ATTESTOR_KEYPAIR_PATH ?? defaultPath);
}

export async function runAttestationKeeper(cfg: AttestationKeeperConfig): Promise<void> {
  const log = (msg: string) => {
    console.log(`[attest-keeper] ${msg}`);
    cfg.onLog?.(msg);
  };
  const oraclePubkey = new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID);
  const [configPda] = deriveAttestationConfigPda(oraclePubkey);

  // ── 1. Config: exists, and pinned to OUR attestor key. ─────────────
  const configInfo = await withSpan(
    "attest.ensure_config",
    { config_pda: configPda.toBase58(), attestor: cfg.attestor.publicKey.toBase58() },
    () => cfg.connection.getAccountInfo(configPda)
  );
  if (!configInfo) {
    log(`initializing attestation config (authority=${cfg.attestor.publicKey.toBase58()})`);
    if (!cfg.dryRun) {
      await withSpan("attest.initialize_config", { config_pda: configPda.toBase58() }, async () => {
        const sig = await sendAndConfirm(cfg, [buildInitializeAttestationConfigIx(cfg.wallet.publicKey, cfg.attestor.publicKey)], "initialize_config");
        recordAction("initialize_config", true);
        return sig;
      });
    }
  } else {
    const authority = new PublicKey(configInfo.data.subarray(8, 40));
    if (!authority.equals(cfg.attestor.publicKey)) {
      throw new Error(
        `On-chain attestation authority ${authority.toBase58()} != local attestor ` +
          `${cfg.attestor.publicKey.toBase58()}. Set ATTESTOR_KEYPAIR_PATH to the pinned key; ` +
          "settlement would revert with SignerMismatch otherwise."
      );
    }
    log(`attestation config OK (authority=${authority.toBase58()})`);
  }

  // ── 2. Event + market. ─────────────────────────────────────────────
  let event = await withSpan("attest.event_fetch", { tsdb_event: cfg.eventId }, () => fetchEvent(cfg.eventId));
  log(`event: ${event.label} (${event.league}), kickoff ${new Date(event.kickoffTs * 1000).toISOString()}`);

  const predicate: MarketPredicate = {
    kind: "total_goals_over",
    matchId: `tsdb:${cfg.eventId}`,
    params: { team: "", threshold: cfg.line },
  };
  const [marketPda] = findMarketPdaFromPredicate(predicate);
  const statement = `total_goals_over:${cfg.line}:tsdb:${cfg.eventId}`;
  log(`market predicate: ${statement} (${marketPda.toBase58()})`);

  const existing = await cfg.connection.getAccountInfo(marketPda);
  if (existing) {
    const m = parseMarket(existing.data, marketPda.toBase58());
    if (m.status === "settled" || m.status === "void") {
      log(`market already ${m.status} (outcome=${m.outcome}) — nothing to do`);
      return;
    }
    if (m.oracle !== ATTESTATION_VALIDATOR_PROGRAM_ID) {
      throw new Error(`market ${marketPda.toBase58()} exists with foreign oracle ${m.oracle}`);
    }
    log(`market exists (status=${m.status}, closes ${m.closesAt})`);
  } else {
    const now = Math.floor(Date.now() / 1000);
    if (event.kickoffTs <= now) {
      throw new Error(
        `kickoff already passed (${new Date(event.kickoffTs * 1000).toISOString()}); ` +
          "create markets before kickoff (closes_at must be in the future)."
      );
    }
    log(
      `creating market: total goals over ${cfg.line} — ${event.label}, ` +
        `closes ${new Date(event.kickoffTs * 1000).toISOString()}`
    );
    if (!cfg.dryRun) {
      await withSpan("attest.create_market", { market: marketPda.toBase58(), statement }, async () => {
        const ix = buildCreateMarketIx({
          creator: cfg.wallet.publicKey,
          predicate,
          closesAt: event.kickoffTs,
          oracle: oraclePubkey,
        });
        const sig = await sendAndConfirm(cfg, [ix], "create_market");
        recordAction("create_market", true);
        return sig;
      });
    }
  }

  // ── 3. Poll until the match finishes. ──────────────────────────────
  const deadline = event.kickoffTs + REFERENCE_OFFSET_SECONDS + WINDOW_SECONDS;
  for (;;) {
    if (!event.finished) {
      if (cfg.dryRun) {
        log(
          `dry-run — match pending (kickoff ${new Date(event.kickoffTs * 1000).toISOString()}); ` +
            "the keeper would poll until full-time, then sign + settle. Exiting."
        );
        return;
      }
      if (Math.floor(Date.now() / 1000) > deadline) {
        log(
          `settlement window expired without a finished observation for ` +
            `${event.label}; the market is unsettleable via this attestation ` +
            "(void path applies after the grace period)."
        );
        process.exitCode = 2;
        return;
      }
      await sleep(POLL_MS);
      try {
        event = await fetchEvent(cfg.eventId);
      } catch (e) {
        log(`poll error (retrying): ${e}`);
      }
      continue;
    }
    break;
  }
  const totalGoals = (event.homeGoals ?? 0) + (event.awayGoals ?? 0);
  log(`final: ${event.label} ${event.homeGoals}-${event.awayGoals} (total ${totalGoals})`);

  // ── 4. Sign + settle. ──────────────────────────────────────────────
  const obsTs = Math.floor(Date.now() / 1000);
  const observation = {
    fixtureRef: fixtureRefForEvent(cfg.eventId),
    statKey: ATTEST_STAT_KEYS.total_goals,
    value: BigInt(totalGoals),
    obsTs,
  };
  const message = buildAttestationMessage(observation);
  const outcome = totalGoals > cfg.line ? 0 : 1; // 0 = YES, 1 = NO
  log(
    `settling ${marketPda.toBase58()}: ${statement} observed total=${totalGoals} ` +
      `(line ${cfg.line}) -> ${outcome === 0 ? "YES" : "NO"}`
  );
  if (cfg.dryRun) {
    log("dry-run — would submit [ed25519, resolve, settle, attest] bundle");
    return;
  }

  // The claim: value > line ⟺ value >= (line + 1). reference_ts is the
  // earliest plausible full-time; the window bounds how late the
  // observation may arrive.
  const claim = {
    op: ATTESTATION_OPS.gte,
    threshold: BigInt(cfg.line) + 1n,
    referenceTs: event.kickoffTs + REFERENCE_OFFSET_SECONDS,
    windowSeconds: WINDOW_SECONDS,
  };
  // CRITICAL ordering (enforced on-chain): inside the bundle the
  // ed25519 precompile instruction IMMEDIATELY precedes resolve_market —
  // the validator reads the instructions sysvar and inspects the
  // previous top-level ix for the authority-bound signature.
  const settlementBundle = buildSettlementBundle(cfg, marketPda, statement, outcome, observation, claim, message);
  const sig = await withSpan(
    "attest.settle",
    {
      market: marketPda.toBase58(),
      statement,
      outcome: outcome === 0 ? "yes" : "no",
      total_goals: totalGoals,
      oracle: "attestation",
    },
    () => sendAndConfirm(cfg, settlementBundle, "settle bundle")
  );
  recordAction("settle_market", true);
  log(`settled ${marketPda.toBase58()} (proof-gated, operator-attested): ${sig}`);
}

function buildSettlementBundle(
  cfg: AttestationKeeperConfig,
  marketPda: PublicKey,
  statement: string,
  outcome: number,
  observation: { fixtureRef: Uint8Array; statKey: number; value: bigint; obsTs: number },
  claim: { op: number; threshold: bigint; referenceTs: number; windowSeconds: number },
  message: Buffer
): Transaction["instructions"] {
  // Sign once; reuse both for the precompile ix and the digest.
  const precompileIx = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: cfg.attestor.secretKey,
    message,
  });
  // Extract the 64-byte signature from the self-contained precompile ix
  // layout: [num=1][pad][7 offsets][sig(64)][pk(32)][msg]. With
  // web3.js's builder the sig starts at byte 16.
  const signature = new Uint8Array(precompileIx.data.subarray(16, 80));

  const resolveIx = buildResolveMarketIxFromOracle(
    attestationOracle,
    cfg.wallet.publicKey,
    marketPda,
    statement,
    outcome,
    {
      ...observation,
      ...claim,
      authority: cfg.attestor.publicKey,
      signature,
    }
  );
  const settleIx = buildSettleFromProofIx(cfg.wallet.publicKey, marketPda, outcome === 0 ? "yes" : "no");
  const attestIx = buildAttestVerificationIx(cfg.wallet.publicKey, marketPda);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    precompileIx,
    resolveIx,
    settleIx,
    attestIx,
  ];
}

async function sendAndConfirm(
  cfg: AttestationKeeperConfig,
  instructions: Transaction["instructions"],
  label: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await cfg.connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: cfg.wallet.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  tx.sign(cfg.wallet);
  const sig = await cfg.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await cfg.connection.confirmTransaction(sig, "confirmed");
  // confirmTransaction does NOT reject on program failure — check meta.
  const status = await cfg.connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const err = status.value[0]?.err;
  if (err) throw new Error(`${label} failed on-chain: ${JSON.stringify(err)} (${sig})`);
  return sig;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { ObservedMatch };
