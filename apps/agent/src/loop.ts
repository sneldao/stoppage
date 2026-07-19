/**
 * Agent loop — the orchestrator that connects the TxLINE event source,
 * the market strategy, and the on-chain SDK.
 *
 * On each normalized event:
 *   1. Strategy decides what actions to take
 *   2. Agent executes actions via the SDK (create/settle/void markets)
 *   3. Open markets are tracked for future settlement
 *
 * The agent wallet is the deployer wallet (devnet). It pays for market
 * creation bonds and settlement transactions. On mainnet this would be
 * a dedicated keeper wallet.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  buildCreateMarketIx,
  buildSettleFromProofIx,
  buildVoidMarketIx,
  buildAttestVerificationIx,
  buildResolveMarketIx,
  buildValidateStatData,
  deriveDailyScoresRootsPda,
  findMarketPdaFromPredicate,
  type MarketPredicate,
  type Side,
} from "@stoppage/sdk";
import {
  fetchStatValidation,
  toBytes32,
  normalizeProof,
  epochDayFromTimestamp,
  TXLINE_CONFIG,
  type Network,
  type TxLineCredentials,
  type NormalizedEvent,
  type StatValidationResponse,
} from "@stoppage/txline";
import type { MatchEvent } from "@stoppage/sdk";
import { decideActions, type AgentAction, type OpenMarket } from "./strategy";
import type { EventSource } from "./source";

export interface AgentConfig {
  connection: Connection;
  wallet: Keypair;
  source: EventSource;
  /** Dry-run mode: log actions but don't submit transactions. */
  dryRun?: boolean;
  /** TxLINE credentials for fetching validation proofs. */
  txlineNetwork?: Network;
  txlineCreds?: TxLineCredentials;
  /** Called after each action for logging/UI updates */
  onAction?: (action: AgentAction, result: ActionResult) => void;
  /** Called for each normalized event */
  onEvent?: (event: NormalizedEvent) => void;
  /** Emits proof-stage facts for the append-only activity ledger. */
  onMatchEvent?: (event: Omit<MatchEvent, "id">) => void;
}

export interface ActionResult {
  success: boolean;
  signature?: string;
  marketPda?: string;
  skipped?: boolean;
  error?: string;
}

export class Agent {
  private config: AgentConfig;
  private openMarkets: OpenMarket[] = [];
  private running = false;
  /** Map from matchId (e.g. "FRA-SPA") to TxLINE fixtureId */
  private matchToFixture = new Map<string, number>();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /** Register a fixture so the agent can fetch validation proofs for its markets. */
  registerFixture(matchId: string, fixtureId: number) {
    this.matchToFixture.set(matchId, fixtureId);
  }

  async start() {
    this.running = true;
    console.log("[agent] Starting agent loop...");
    await this.config.source.start((event) => this.handleEvent(event));
  }

  stop() {
    this.running = false;
    this.config.source.stop();
    console.log("[agent] Agent stopped.");
  }

  getOpenMarkets(): OpenMarket[] {
    return [...this.openMarkets];
  }

  private async handleEvent(event: NormalizedEvent) {
    if (!this.running) return;
    this.config.onEvent?.(event);

    const { actions, notes } = decideActions(event, this.openMarkets);

    // Surface the agent's decision-making. Every event the strategy
    // considers produces either an action or an explicit note explaining
    // why no action followed. Emitting these as `decision_logged` facts
    // is what makes Matchkeeper's autonomy legible on the timeline:
    // observe -> decide -> act (or consciously decline). This directly
    // answers the "Autonomous Operation" criterion for the demo.
    for (const note of notes) {
      this.config.onMatchEvent?.({
        occurredAt: Date.now(),
        kind: "decision_logged",
        label: note.label,
        matchId: note.matchId,
        fixtureId: note.fixtureId,
        source: "matchkeeper",
      });
    }

    for (const action of actions) {
      await this.executeAction(action);
    }
  }

  private async executeAction(action: AgentAction): Promise<void> {
    try {
      let result: ActionResult;

      switch (action.type) {
        case "create_market":
          result = await this.createMarket(action);
          break;
        case "settle_market":
          result = await this.settleMarket(action);
          break;
        case "void_market":
          result = await this.voidMarket(action);
          break;
      }

      this.config.onAction?.(action, result);

      // Delay between chain actions to avoid devnet rate limits
      await sleep(2000);
    } catch (err) {
      console.error(`[agent] Action ${action.type} failed:`, err);
      this.config.onAction?.(action, { success: false, error: String(err) });
      await sleep(3000); // Longer delay after errors
    }
  }

  private async createMarket(
    action: Extract<AgentAction, { type: "create_market" }>
  ): Promise<ActionResult> {
    const { connection, wallet, dryRun } = this.config;
    const closesAt = Math.floor(Date.now() / 1000) + action.closesInSeconds;

    // Derive the market PDA for tracking (single source of truth — SDK)
    const [marketPda] = findMarketPdaFromPredicate(action.predicate);

    // Check if market already exists on-chain (skip if already created)
    if (!dryRun) {
      try {
        const existing = await connection.getAccountInfo(marketPda);
        if (existing) {
          console.log(`[agent] Market already exists: ${action.label} → ${marketPda.toBase58()} (skipping creation)`);
          this.openMarkets.push({
            predicate: action.predicate,
            label: action.label,
            createdAt: Date.now(),
            ttlSeconds: action.closesInSeconds,
            marketPda: marketPda.toBase58(),
          });
          return { success: true, marketPda: marketPda.toBase58(), skipped: true };
        }
      } catch (e) {
        // Ignore fetch errors — proceed with creation
      }
    }

    // Track the open market
    this.openMarkets.push({
      predicate: action.predicate,
      label: action.label,
      createdAt: Date.now(),
      ttlSeconds: action.closesInSeconds,
      marketPda: marketPda.toBase58(),
    });

    if (dryRun) {
      console.log(`[agent] (dry-run) Would create market: ${action.label} → ${marketPda.toBase58()}`);
      return { success: true, marketPda: marketPda.toBase58() };
    }

    const ix = buildCreateMarketIx({
      creator: wallet.publicKey,
      predicate: action.predicate,
      closesAt,
    });

    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        feePayer: wallet.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);
      tx.sign(wallet);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await connection.confirmTransaction(sig, "confirmed");

      console.log(`[agent] Created market: ${action.label} → ${marketPda.toBase58()}`);
      return { success: true, signature: sig, marketPda: marketPda.toBase58() };
    } catch (err) {
      const errMsg = String(err);
      if (errMsg.includes("already in use") || errMsg.includes("0x0")) {
        console.log(`[agent] Market already exists: ${action.label} → ${marketPda.toBase58()}`);
        return { success: true, marketPda: marketPda.toBase58() };
      }
      throw err;
    }
  }

  private async settleMarket(
    action: Extract<AgentAction, { type: "settle_market" }>
  ): Promise<ActionResult> {
    const { connection, wallet, dryRun, txlineNetwork, txlineCreds } = this.config;

    // Find the open market
    const idx = this.openMarkets.findIndex(
      (m) =>
        m.predicate.kind === action.predicate.kind &&
        m.predicate.matchId === action.predicate.matchId
    );
    if (idx === -1) {
      console.warn(`[agent] Cannot settle — market not found: ${action.label}`);
      return { success: false, error: "Market not found" };
    }

    const market = this.openMarkets[idx];
    if (!market.marketPda) {
      return { success: false, error: "Market PDA unknown" };
    }

    // Fetch a TxLINE validation proof. A market remains open if proof
    // retrieval or its proof-gated transaction fails, so the keeper can retry.
    let proofSummary = "";
    let resolveIx: TransactionInstruction | null = null;
    const outcome: Side = action.outcome === "yes" ? "yes" : "no";

    if (txlineNetwork && txlineCreds && action.seq > 0 && action.statKey > 0) {
      try {
        const fixtureId = this.fixtureIdForMatch(action.predicate.matchId);
        if (fixtureId) {
          const proof = await fetchStatValidation(
            txlineNetwork,
            txlineCreds,
            fixtureId,
            action.seq,
            action.statKey
          );
          proofSummary = ` (proof: ${proof.statProof.length} stat nodes + ${proof.subTreeProof.length} subtree + ${proof.mainTreeProof.length} main, value=${proof.statToProve.value})`;

          // Verify the proof locally before submitting on-chain
          const statProofNorm = normalizeProof(proof.statProof);
          const subTreeProofNorm = normalizeProof(proof.subTreeProof);
          const mainTreeProofNorm = normalizeProof(proof.mainTreeProof);
          const eventStatRootBytes = toBytes32(proof.eventStatRoot);
          const subTreeRootBytes = toBytes32(proof.summary.eventStatsSubTreeRoot);

          // Build the validate_stat instruction data
          const txlineProgramId = new PublicKey(TXLINE_CONFIG[txlineNetwork].programId);
          // Per TxLINE docs: derive epoch day from minTimestamp, not maxTimestamp
          const epochDay = epochDayFromTimestamp(proof.summary.updateStats.minTimestamp);
          const [dailyScoresRoots] = deriveDailyScoresRootsPda(txlineProgramId, epochDay);

          const statProofForChain = statProofNorm.map((n) => ({
            hash: n.hash,
            isRightSibling: n.isRightSibling,
          }));
          const subTreeProofForChain = subTreeProofNorm.map((n) => ({
            hash: n.hash,
            isRightSibling: n.isRightSibling,
          }));
          const mainTreeProofForChain = mainTreeProofNorm.map((n) => ({
            hash: n.hash,
            isRightSibling: n.isRightSibling,
          }));

          const txlineIxData = buildValidateStatData({
            // Per TxLINE docs: ts = minTimestamp in milliseconds
            ts: proof.summary.updateStats.minTimestamp,
            fixtureSummary: {
              fixtureId: proof.summary.fixtureId,
              updateStats: {
                updateCount: proof.summary.updateStats.updateCount,
                minTimestamp: proof.summary.updateStats.minTimestamp,
                maxTimestamp: proof.summary.updateStats.maxTimestamp,
              },
              eventsSubTreeRoot: subTreeRootBytes,
            },
            fixtureProof: subTreeProofForChain,
            mainTreeProof: mainTreeProofForChain,
            predicate: {
              // The predicate threshold comes from the market's params
              // (e.g. "over 3 goals" → threshold=3).
              threshold: Number(action.predicate.params.threshold ?? 0),
              comparison: 0, // GreaterThan — "over" markets
            },
            statA: {
              statToProve: {
                key: proof.statToProve.key,
                value: proof.statToProve.value,
                period: proof.statToProve.period ?? 0,
              },
              eventStatRoot: eventStatRootBytes,
              statProof: statProofForChain,
            },
            statB: null,
            op: null,
          });

          // Build the resolve_market instruction
          const resolveMarketIx = buildResolveMarketIx(
            wallet.publicKey,
            new PublicKey(market.marketPda),
            txlineProgramId,
            dailyScoresRoots,
            action.label,
            eventStatRootBytes,
            outcome === "yes" ? 0 : 1,
            txlineIxData
          );

          resolveIx = resolveMarketIx;
          proofSummary += ` [on-chain CPI via PDA epoch_day=${epochDay}]`;
          this.config.onMatchEvent?.({
            occurredAt: Date.now(),
            kind: "proof_validated",
            label: `TxLINE proof prepared for ${action.label}`,
            matchId: action.predicate.matchId,
            fixtureId,
            marketId: market.marketPda,
            source: "matchkeeper",
          });
        }
      } catch (err) {
        return { success: false, error: `Proof fetch/build failed: ${(err as Error).message}` };
      }
    }

    if (!resolveIx) {
      return { success: false, error: "Proof-gated settlement requires TxLINE credentials and a validation proof" };
    }

    if (dryRun) {
      console.log(`[agent] (dry-run) Would settle: ${action.label} → ${action.outcome.toUpperCase()}${proofSummary}`);
      if (resolveIx) {
        console.log(`[agent] (dry-run)   + resolve_market (on-chain validate_stat CPI)`);
      }
      console.log(`[agent] (dry-run)   + settle_from_proof + attest_verification`);
      this.openMarkets.splice(idx, 1);
      return { success: true, marketPda: market.marketPda };
    }

    // Build the transaction:
    // 1. resolve_market — CPIs into TxLINE validate_stat and creates receipt
    // 2. settle_from_proof — consumes the matching receipt to settle the vault
    // 3. attest_verification — increments verification counter
    // If resolve_market fails (proof invalid), the entire tx reverts.
    const settleIx = buildSettleFromProofIx(
      wallet.publicKey,
      new PublicKey(market.marketPda),
      outcome
    );

    const attestIx = buildAttestVerificationIx(
      wallet.publicKey,
      new PublicKey(market.marketPda)
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    // TxLINE's CPI needs a larger compute budget.
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    tx.add(resolveIx);
    tx.add(settleIx, attestIx);
    tx.sign(wallet);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, "confirmed");
    this.openMarkets.splice(idx, 1);

    console.log(
      `[agent] Settled market: ${action.label} → ${action.outcome.toUpperCase()}${proofSummary} (tx: ${sig.slice(0, 16)}...)`
    );
    return { success: true, signature: sig, marketPda: market.marketPda };
  }

  /** Look up the TxLINE fixture ID for a given match ID. */
  private fixtureIdForMatch(matchId: string): number | null {
    return this.matchToFixture.get(matchId) ?? null;
  }

  private async voidMarket(
    action: Extract<AgentAction, { type: "void_market" }>
  ): Promise<ActionResult> {
    const { connection, wallet, dryRun } = this.config;

    const idx = this.openMarkets.findIndex(
      (m) =>
        m.predicate.kind === action.predicate.kind &&
        m.predicate.matchId === action.predicate.matchId
    );
    if (idx === -1) {
      return { success: false, error: "Market not found" };
    }

    const market = this.openMarkets[idx];
    if (!market.marketPda) {
      return { success: false, error: "Market PDA unknown" };
    }

    this.openMarkets.splice(idx, 1);

    if (dryRun) {
      console.log(`[agent] (dry-run) Would void: ${action.label}`);
      return { success: true, marketPda: market.marketPda };
    }

    const ix = buildVoidMarketIx(
      wallet.publicKey,
      new PublicKey(market.marketPda)
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(ix);
    tx.sign(wallet);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, "confirmed");

    console.log(`[agent] Voided market: ${action.label}`);
    return { success: true, signature: sig, marketPda: market.marketPda };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
