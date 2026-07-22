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
  buildAttestPricingIx,
  signQuote,
  deriveDailyScoresRootsPda,
  findMarketPdaFromPredicate,
  type MarketPredicate,
  type Side,
  type QuoteSignaturePayload,
} from "@stoppage/sdk";
import { hashSnapshot, deriveSeed } from "@stoppage/quant";
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
import { decideActions, quoteOpenMarkets, type AgentAction, type OpenMarket } from "./strategy";
import type { EventSource } from "./source";
import { getQuantModel, DEFAULT_QUANT_PARAMS, type QuantModel } from "./quantClient";
import { QuoteTracker } from "./quoteTracker";
import {
  logger,
  recordAction,
  recordProofFetch,
  recordTxlineEvent,
  withSpan,
} from "./telemetry";

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
  /** Live verifiable quote store (Phase 3A). */
  quoteTracker?: QuoteTracker;
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
  /** Live match state per matchId for quote snapshot construction. */
  private matchState = new Map<string, {
    fixtureId: number;
    minute: number;
    score: { home: number; away: number };
    corners: { home: number; away: number };
    cards: { homeYellow: number; homeRed: number; awayYellow: number; awayRed: number };
    seq: number;
  }>();
  private quant: QuantModel = getQuantModel();
  /** Team name lookup per matchId (for corner/card attribution). */
  private teamNames = new Map<string, { home: string; away: string }>();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /** Register a fixture so the agent can fetch validation proofs for its markets. */
  registerFixture(matchId: string, fixtureId: number) {
    this.matchToFixture.set(matchId, fixtureId);
  }

  /** Register team names so corner/card events attribute to the right side. */
  registerTeams(matchId: string, home: string, away: string) {
    this.teamNames.set(matchId, { home, away });
  }

  async start() {
    this.running = true;
    logger.info("Starting agent loop");
    await this.config.source.start((event) => this.handleEvent(event));
  }

  stop() {
    this.running = false;
    this.config.source.stop();
    logger.info("Agent stopped");
  }

  getOpenMarkets(): OpenMarket[] {
    return [...this.openMarkets];
  }

  /**
   * Track live match state for quote snapshots. Minute is derived from the
   * phase + elapsed time since match start; corners/cards accumulate from
   * the running score map. The snapshot shape MUST match what Person 2
   * anchors on-chain for the verify loop to hold.
   */
  private updateMatchState(event: NormalizedEvent) {
    if (!("matchId" in event) || !event.matchId) return;
    const matchId = event.matchId;
    const fixtureId = this.matchToFixture.get(matchId);
    if (fixtureId === undefined) return;

    const prev = this.matchState.get(matchId) ?? {
      fixtureId,
      minute: 0,
      score: { home: 0, away: 0 },
      corners: { home: 0, away: 0 },
      cards: { homeYellow: 0, homeRed: 0, awayYellow: 0, awayRed: 0 },
      seq: 0,
    };

    const seq = "seq" in event ? event.seq : prev.seq;
    const next = { ...prev, seq };

    switch (event.type) {
      case "match_started":
        next.minute = 0;
        break;
      case "goal_scored":
        if (event.team === this.homeTeamFor(matchId)) next.score.home += 1;
        else if (event.team === this.awayTeamFor(matchId)) next.score.away += 1;
        break;
      case "corner_awarded":
        if (event.team === this.homeTeamFor(matchId)) next.corners.home += 1;
        else if (event.team === this.awayTeamFor(matchId)) next.corners.away += 1;
        break;
      case "card_shown":
        if (event.cardType === "red") {
          if (event.team === this.homeTeamFor(matchId)) next.cards.homeRed += 1;
          else if (event.team === this.awayTeamFor(matchId)) next.cards.awayRed += 1;
        } else {
          if (event.team === this.homeTeamFor(matchId)) next.cards.homeYellow += 1;
          else if (event.team === this.awayTeamFor(matchId)) next.cards.awayYellow += 1;
        }
        break;
      case "halftime":
        next.minute = 45;
        break;
      case "second_half_started":
        next.minute = 45;
        break;
      case "match_ended":
        next.minute = 90;
        next.score = event.finalScore ?? next.score;
        break;
    }

    this.matchState.set(matchId, next);
  }

  private homeTeamFor(matchId: string): string {
    return this.teamNames.get(matchId)?.home ?? "";
  }

  private awayTeamFor(matchId: string): string {
    return this.teamNames.get(matchId)?.away ?? "";
  }

  private async handleEvent(event: NormalizedEvent) {
    if (!this.running) return;

    if (event.type !== "heartbeat") {
      recordTxlineEvent(event.type);
    }

    const matchId = "matchId" in event ? event.matchId : undefined;
    const fixtureId = matchId ? this.matchToFixture.get(matchId) : undefined;

    await withSpan(
      "txline_event",
      {
        "event.type": event.type,
        "match.id": matchId,
        "fixture.id": fixtureId,
      },
      async () => {
        this.config.onEvent?.(event);

        // Maintain live match state for quote snapshots.
        this.updateMatchState(event);

        const { actions, notes } = decideActions(event, this.openMarkets);

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

        const eventMatchId = "matchId" in event ? event.matchId : undefined;
        const state = eventMatchId ? this.matchState.get(eventMatchId) : undefined;
        if (state && eventMatchId && this.config.quoteTracker) {
          const quoteActions = quoteOpenMarkets(
            eventMatchId,
            state.fixtureId,
            state.minute,
            state.score,
            state.corners,
            state.cards,
            state.seq,
            event.ts,
            this.openMarkets
          );
          for (const qa of quoteActions) {
            await this.executeAction(qa);
          }
        }

        for (const action of actions) {
          await this.executeAction(action);
        }
      }
    );
  }

  private async executeAction(action: AgentAction): Promise<void> {
    await withSpan(
      "agent.execute_action",
      {
        "action.type": action.type,
        "match.id": action.predicate.matchId,
        "predicate.kind": action.predicate.kind,
      },
      async () => {
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
            case "quote_market":
              result = await this.quoteMarket(action);
              break;
          }

          recordAction(action.type, result.success);
          this.config.onAction?.(action, result);

          // Delay between chain actions to avoid devnet rate limits
          await sleep(2000);
        } catch (err) {
          recordAction(action.type, false);
          logger.error("Action failed", {
            "action.type": action.type,
            error: String(err),
          });
          this.config.onAction?.(action, { success: false, error: String(err) });
          await sleep(3000);
        }
      }
    );
  }

  private async submitSignedTx(
    tx: Transaction,
    attrs: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    return withSpan("tx_submit", attrs, async () => {
      const sig = await this.config.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await this.config.connection.confirmTransaction(sig, "confirmed");
      return sig;
    });
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
          logger.info("Market already exists, skipping creation", {
            label: action.label,
            "market.pda": marketPda.toBase58(),
          });
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
      logger.info("Dry-run: would create market", {
        label: action.label,
        "market.pda": marketPda.toBase58(),
      });
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

      const sig = await this.submitSignedTx(tx, {
        "action.type": "create_market",
        "market.pda": marketPda.toBase58(),
      });

      logger.info("Created market", {
        label: action.label,
        "market.pda": marketPda.toBase58(),
        "tx.signature": sig,
      });
      return { success: true, signature: sig, marketPda: marketPda.toBase58() };
    } catch (err) {
      const errMsg = String(err);
      if (errMsg.includes("already in use") || errMsg.includes("0x0")) {
        logger.info("Market already exists on-chain", {
          label: action.label,
          "market.pda": marketPda.toBase58(),
        });
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
      logger.warn("Cannot settle — market not found", { label: action.label });
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
          const proof = await withSpan(
            "proof_fetch",
            {
              "fixture.id": fixtureId,
              "match.id": action.predicate.matchId,
              "market.pda": market.marketPda,
            },
            async () =>
              fetchStatValidation(
                txlineNetwork,
                txlineCreds,
                fixtureId,
                action.seq,
                action.statKey
              )
          );
          recordProofFetch(true);
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
        recordProofFetch(false);
        return { success: false, error: `Proof fetch/build failed: ${(err as Error).message}` };
      }
    }

    if (!resolveIx) {
      return { success: false, error: "Proof-gated settlement requires TxLINE credentials and a validation proof" };
    }

    if (dryRun) {
      logger.info("Dry-run: would settle market", {
        label: action.label,
        outcome: action.outcome,
        proof: proofSummary,
      });
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

    const sig = await this.submitSignedTx(tx, {
      "action.type": "settle_market",
      "market.pda": market.marketPda,
      outcome: action.outcome,
    });
    this.openMarkets.splice(idx, 1);

    logger.info("Settled market", {
      label: action.label,
      outcome: action.outcome,
      "market.pda": market.marketPda,
      "tx.signature": sig,
      proof: proofSummary,
    });
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
      logger.info("Dry-run: would void market", { label: action.label });
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

    const sig = await this.submitSignedTx(tx, {
      "action.type": "void_market",
      "market.pda": market.marketPda,
    });

    logger.info("Voided market", {
      label: action.label,
      "market.pda": market.marketPda,
      "tx.signature": sig,
    });
    return { success: true, signature: sig, marketPda: market.marketPda };
  }

  /**
   * Phase 3A — re-price an open market with the verifiable quant model and
   * publish the resulting bid/ask as a live reference line. Records the
   * quote into the QuoteTracker (for the HTTP/SSE read paths) and emits a
   * `quote_updated` ledger fact so the timeline shows Matchkeeper pricing,
   * not just settling. No chain call — 3B adds the counter-party.
   */
  private async quoteMarket(
    action: Extract<AgentAction, { type: "quote_market" }>
  ): Promise<ActionResult> {
    const open = this.openMarkets.find(
      (m) =>
        m.predicate.kind === action.predicate.kind &&
        m.predicate.matchId === action.predicate.matchId
    );
    if (!open) return { success: false, error: "Market not found" };
    const marketPda = open.marketPda;
    if (!marketPda) return { success: false, error: "Market PDA unknown" };

    // Deterministic seed from predicate kind + matchId + seq so the same
    // snapshot always reproduces the same quote off-chain (the verify contract).
    // deriveSeed is shared with the browser verify loop in @stoppage/quant.
    const seed = deriveSeed(action.predicate.kind, action.snapshot);
    const result = this.quant.priceMarket(
      action.predicate,
      action.snapshot,
      DEFAULT_QUANT_PARAMS,
      seed
    );

    // Phase 3B hook: inventory skew would widen the spread here. Stub = 0
    // (neutral book) until the agent holds inventory.
    const inventorySkew: number = 0;

    this.config.quoteTracker?.record({
      marketId: marketPda,
      label: action.label,
      predicateKind: action.predicate.kind,
      snapshot: action.snapshot,
      result,
      inventorySkew,
      ts: Date.now(),
    });

    this.config.onMatchEvent?.({
      occurredAt: Date.now(),
      kind: "quote_updated",
      label: `${action.label} → fair ${Math.round(result.fairValue * 100)}¢ (bid ${Math.round(result.bid * 100)} / ask ${Math.round(result.ask * 100)})`,
      matchId: action.predicate.matchId,
      marketId: marketPda,
      source: "matchkeeper",
    });

    // Submit the on-chain pricing attestation. This is best-effort: a
    // failed attestation does not block the live quote from being published.
    if (!this.config.dryRun) {
      try {
        const snapshotHashHex = hashSnapshot(action.snapshot);
        const snapshotHashBytes = Buffer.from(snapshotHashHex, "hex");
        const ts = Math.floor(Date.now() / 1000);

        // Sign over the quote fields with the agent wallet's Ed25519 key.
        // The signature covers the market, snapshot hash, model version,
        // scaled fair value / bid / ask, and timestamp — the same fields
        // stored in the pricing receipt, so anyone can verify them later.
        const signaturePayload: QuoteSignaturePayload = {
          market: marketPda,
          snapshotHash: snapshotHashHex,
          modelVersion: result.modelVersion,
          fairValue: result.fairValue,
          bid: result.bid,
          ask: result.ask,
          ts,
        };
        const agentSignature = signQuote(this.config.wallet.secretKey, signaturePayload);

        const attestIx = buildAttestPricingIx({
          agentAuthority: this.config.wallet.publicKey,
          market: new PublicKey(marketPda),
          snapshotHash: snapshotHashBytes,
          modelVersion: result.modelVersion,
          fairValue: result.fairValue,
          bid: result.bid,
          ask: result.ask,
          agentSignature,
          ts,
        });

        const { blockhash, lastValidBlockHeight } = await this.config.connection.getLatestBlockhash();
        const tx = new Transaction({
          feePayer: this.config.wallet.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(attestIx);
        tx.sign(this.config.wallet);
        const sig = await this.submitSignedTx(tx, {
          "action.type": "quote_market",
          "market.pda": marketPda,
        });
        logger.info("Attested pricing", {
          label: action.label,
          "market.pda": marketPda,
          "tx.signature": sig,
        });
      } catch (err) {
        logger.warn("Pricing attestation failed", {
          label: action.label,
          error: String(err),
        });
      }
    }

    if (inventorySkew !== 0) {
      this.config.onMatchEvent?.({
        occurredAt: Date.now(),
        kind: "inventory_skew",
        label: `${action.label} inventory skew ${inventorySkew.toFixed(2)}`,
        matchId: action.predicate.matchId,
        marketId: marketPda,
        source: "matchkeeper",
      });
    }

    return { success: true, marketPda };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
