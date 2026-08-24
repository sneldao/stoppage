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
  clusterApiUrl,
} from "@solana/web3.js";
import {
  buildClaimBondIx,
  buildClaimIx,
  buildCreateMarketIx,
  buildVoidMarketIx,
  buildAttestPricingIx,
  signQuote,
  findMarketPdaFromPredicate,
  findPositionPda,
  getMarket,
  DEFAULT_ORACLE,
  type MarketPredicate,
  type Side,
  type QuoteSignaturePayload,
} from "@stoppage/sdk";
import { hashSnapshot, deriveSeed } from "@stoppage/quant";
import {
  type Network,
  type TxLineCredentials,
  type NormalizedEvent,
} from "@stoppage/txline";
import type { MatchEvent } from "@stoppage/sdk";
import { decideActions, quoteOpenMarkets, type AgentAction, type OpenMarket } from "./strategy";
import { buildSettleFromProofIxs, attestVerification } from "./settle";
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
import * as fs from "fs";
import * as path from "path";

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
  /**
   * Directory for pending-settlement persistence (PM2 restart survival).
   * Defaults next to MATCH_EVENTS_PATH or `.runtime`.
   */
  pendingSettlementsPath?: string;
}

export interface ActionResult {
  success: boolean;
  signature?: string;
  marketPda?: string;
  skipped?: boolean;
  error?: string;
}

interface PendingSettlement {
  action: Extract<AgentAction, { type: "settle_market" }>;
  attempts: number;
  nextAttemptAt: number;
  enqueuedAt: number;
}

const SETTLE_RETRY_INITIAL_MS = 5 * 60 * 1000;
const SETTLE_RETRY_MAX_MS = 30 * 60 * 1000;
const SETTLE_RETRY_GIVE_UP_MS = 8 * 60 * 60 * 1000;
const SETTLE_RETRY_TICK_MS = 30 * 1000;
/** Periodic housekeeping: give-up-void stale settlements + claim sweep. */
const HOUSEKEEP_TICK_MS = 15 * 60 * 1000;

export class Agent {
  private config: AgentConfig;
  private openMarkets: OpenMarket[] = [];
  private running = false;
  /** Map from matchId (e.g. "CIT-CIN-17615188") to TxLINE fixtureId */
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
  private pendingSettlements = new Map<string, PendingSettlement>();
  private settleRetryTimer: ReturnType<typeof setInterval> | null = null;
  private housekeepTimer: ReturnType<typeof setInterval> | null = null;
  /** Every market this process created/settled/voided — the claim sweep set. */
  private knownMarketPdas = new Set<string>();

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
    this.loadPendingSettlements();
    this.settleRetryTimer = setInterval(() => {
      void this.processPendingSettlements();
    }, SETTLE_RETRY_TICK_MS);
    this.housekeepTimer = setInterval(() => {
      void this.housekeepPass();
    }, HOUSEKEEP_TICK_MS);
    logger.info("Starting agent loop", {
      pendingSettlements: this.pendingSettlements.size,
    });
    await this.config.source.start((event) => this.handleEvent(event));
  }

  stop() {
    this.running = false;
    if (this.settleRetryTimer) {
      clearInterval(this.settleRetryTimer);
      this.settleRetryTimer = null;
    }
    if (this.housekeepTimer) {
      clearInterval(this.housekeepTimer);
      this.housekeepTimer = null;
    }
    this.persistPendingSettlements();
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

        const eventMatchId = "matchId" in event ? event.matchId : undefined;
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

  private async executeAction(action: AgentAction): Promise<ActionResult> {
    return withSpan(
      "agent.execute_action",
      {
        "action.type": action.type,
        "match.id": action.predicate.matchId,
        "predicate.kind": action.predicate.kind,
      },
      async (): Promise<ActionResult> => {
        try {
          let result: ActionResult;

          switch (action.type) {
            case "create_market":
              result = await this.createMarket(action);
              break;
            case "settle_market":
              result = await this.settleMarket(action);
              if (!result.success && result.marketPda) {
                this.enqueueSettlementRetry(action, result);
              } else if (result.success && result.marketPda) {
                this.pendingSettlements.delete(result.marketPda);
                this.persistPendingSettlements();
              }
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
          if (result.success && result.marketPda) {
            this.knownMarketPdas.add(result.marketPda);
          }

          // Delay between chain actions to avoid devnet rate limits
          await sleep(2000);
          return result;
        } catch (err) {
          recordAction(action.type, false);
          logger.error("Action failed", {
            "action.type": action.type,
            error: String(err),
          });
          this.config.onAction?.(action, { success: false, error: String(err) });
          await sleep(3000);
          return { success: false, error: String(err) };
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
      // Confirmation alone doesn't surface program errors — a tx can
      // be "confirmed" yet reverted on-chain. Check the status or the
      // keeper logs false successes and drops retries.
      const st = await this.config.connection.getSignatureStatuses([sig], {
        searchTransactionHistory: true,
      });
      const err = st.value[0]?.err;
      if (err) {
        throw new Error(`tx reverted on-chain: ${JSON.stringify(err)} (${sig})`);
      }
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
      oracle: DEFAULT_ORACLE,
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
    // Capture the narrowed PDA (property narrowing doesn't survive closures).
    const marketPdaKey = new PublicKey(market.marketPda);

    // Fetch a TxLINE validation proof and build the resolve+settle
    // instructions (shared implementation: ./settle.ts). A market stays
    // open if proof retrieval or the proof-gated tx fails, so the
    // keeper can retry.
    let proofSummary = "";
    let settleIxs: TransactionInstruction[] | null = null;
    const outcome: Side = action.outcome === "yes" ? "yes" : "no";

    if (txlineNetwork && txlineCreds && action.seq > 0 && action.statKey > 0) {
      try {
        const fixtureId = this.fixtureIdForMatch(action.predicate.matchId);
        if (fixtureId) {
          const built = await withSpan(
            "proof_fetch",
            {
              "fixture.id": fixtureId,
              "match.id": action.predicate.matchId,
              "market.pda": market.marketPda,
            },
            () =>
              buildSettleFromProofIxs({
                network: txlineNetwork,
                creds: txlineCreds,
                fixtureId,
                seq: action.seq,
                statKey: action.statKey,
                statKey2: action.statKey2,
                // The predicate threshold comes from the market's params
                // (e.g. "over 3 goals" → threshold=3).
                threshold: Number(action.predicate.params.threshold ?? 0),
                outcome,
                statement: action.label,
                marketPda: marketPdaKey,
                wallet: wallet.publicKey,
              })
          );
          recordProofFetch(true);
          settleIxs = built.instructions;
          proofSummary = built.proofSummary;
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
        return {
          success: false,
          marketPda: market.marketPda,
          error: `Proof fetch/build failed: ${(err as Error).message}`,
        };
      }
    }

    if (!settleIxs) {
      return {
        success: false,
        marketPda: market.marketPda,
        error: "Proof-gated settlement requires TxLINE credentials and a validation proof",
      };
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

    // Settlement tx: compute budget + resolve_market (CPIs into TxLINE
    // validate_stat, creates the receipt) + settle_from_proof (consumes
    // the receipt to settle the vault). If the proof is invalid the
    // whole tx reverts. attest_verification runs as a best-effort
    // follow-up — two-stat proofs fill the 1232-byte tx budget.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(...settleIxs);
    tx.sign(wallet);

    const sig = await this.submitSignedTx(tx, {
      "action.type": "settle_market",
      "market.pda": market.marketPda,
      outcome: action.outcome,
    });
    this.openMarkets.splice(idx, 1);

    const attestSig = await attestVerification(
      connection,
      wallet,
      new PublicKey(market.marketPda)
    );
    if (attestSig) {
      logger.info("Attested verification", {
        "market.pda": market.marketPda,
        "tx.signature": attestSig,
      });
    } else {
      logger.warn("Attestation follow-up failed (market still settled)", {
        "market.pda": market.marketPda,
      });
    }

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

  private pendingSettlementsFile(): string {
    if (this.config.pendingSettlementsPath) {
      return this.config.pendingSettlementsPath;
    }
    const eventsPath = process.env.MATCH_EVENTS_PATH ?? ".runtime/match-events.ndjson";
    return path.join(path.dirname(eventsPath), "pending-settlements.json");
  }

  private enqueueSettlementRetry(
    action: Extract<AgentAction, { type: "settle_market" }>,
    result: ActionResult
  ) {
    const key = result.marketPda!;
    const existing = this.pendingSettlements.get(key);
    const attempts = (existing?.attempts ?? 0) + 1;
    const delay = Math.min(
      SETTLE_RETRY_INITIAL_MS * 2 ** Math.max(0, attempts - 1),
      SETTLE_RETRY_MAX_MS
    );
    const nextAttemptAt = Date.now() + delay;
    const enqueuedAt = existing?.enqueuedAt ?? Date.now();

    if (Date.now() - enqueuedAt > SETTLE_RETRY_GIVE_UP_MS) {
      logger.warn("Giving up on settlement retry after 8h", {
        label: action.label,
        "market.pda": key,
        error: result.error,
      });
      this.config.onMatchEvent?.({
        occurredAt: Date.now(),
        kind: "decision_logged",
        label: `Proof still unavailable for ${action.label} after ~8h — void manually if needed`,
        matchId: action.predicate.matchId,
        marketId: key,
        source: "matchkeeper",
      });
      this.pendingSettlements.delete(key);
      this.persistPendingSettlements();
      return;
    }

    this.pendingSettlements.set(key, { action, attempts, nextAttemptAt, enqueuedAt });
    this.persistPendingSettlements();
    logger.info("Enqueued settlement retry", {
      label: action.label,
      attempts,
      nextAttemptAt: new Date(nextAttemptAt).toISOString(),
      error: result.error,
    });
    this.config.onMatchEvent?.({
      occurredAt: Date.now(),
      kind: "decision_logged",
      label: `Proof not yet available for ${action.label}, retry ${attempts} in ${Math.round(delay / 60000)}m`,
      matchId: action.predicate.matchId,
      marketId: key,
      source: "matchkeeper",
    });
  }

  private async processPendingSettlements() {
    if (!this.running || this.pendingSettlements.size === 0) return;
    const now = Date.now();
    for (const [key, pending] of [...this.pendingSettlements.entries()]) {
      if (pending.nextAttemptAt > now) continue;
      // Ensure the market is still tracked as open so settleMarket can find it.
      const tracked = this.openMarkets.some((m) => m.marketPda === key);
      if (!tracked && pending.action.predicate) {
        this.openMarkets.push({
          predicate: pending.action.predicate,
          label: pending.action.label,
          createdAt: pending.enqueuedAt,
          ttlSeconds: 7200,
          marketPda: key,
        });
      }
      logger.info("Retrying pending settlement", {
        label: pending.action.label,
        attempts: pending.attempts,
      });
      await this.executeAction(pending.action);
    }
  }

  private loadPendingSettlements() {
    const file = this.pendingSettlementsFile();
    try {
      if (!fs.existsSync(file)) return;
      const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
        marketPda: string;
        action: Extract<AgentAction, { type: "settle_market" }>;
        attempts: number;
        nextAttemptAt: number;
        enqueuedAt: number;
      }>;
      this.pendingSettlements.clear();
      for (const row of rows) {
        if (!row?.marketPda || !row.action?.predicate?.matchId) continue;
        this.pendingSettlements.set(row.marketPda, {
          action: row.action,
          attempts: row.attempts ?? 0,
          nextAttemptAt: row.nextAttemptAt ?? Date.now(),
          enqueuedAt: row.enqueuedAt ?? Date.now(),
        });
        if (!this.openMarkets.some((m) => m.marketPda === row.marketPda)) {
          this.openMarkets.push({
            predicate: row.action.predicate,
            label: row.action.label,
            createdAt: row.enqueuedAt ?? Date.now(),
            ttlSeconds: 7200,
            marketPda: row.marketPda,
          });
        }
      }
      if (this.pendingSettlements.size > 0) {
        logger.info("Rehydrated pending settlements", {
          count: this.pendingSettlements.size,
          file,
        });
      }
    } catch (err) {
      logger.warn("Failed to load pending settlements", {
        file,
        error: String(err),
      });
    }
  }

  private persistPendingSettlements() {
    const file = this.pendingSettlementsFile();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const rows = [...this.pendingSettlements.entries()].map(([marketPda, p]) => ({
        marketPda,
        action: p.action,
        attempts: p.attempts,
        nextAttemptAt: p.nextAttemptAt,
        enqueuedAt: p.enqueuedAt,
      }));
      fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    } catch (err) {
      logger.warn("Failed to persist pending settlements", {
        file,
        error: String(err),
      });
    }
  }

  /**
 * Housekeeping pass (Phase 2) — runs on HOUSEKEEP_TICK_MS. Mirrors
 * scripts/housekeep.ts but inside the live loop with its own wallet.
 *   A) Give-up-void pending settlements older than the retry window.
 *   B) Claim sweep: creator bonds + held positions for markets we made.
 * All idempotent: an already-claimed claim is a benign no-op.
 */
private async housekeepPass() {
  if (!this.running) return;
  const now = Date.now();

  // A) Pending settlements past the give-up window: one final settle
  //    attempt, then void so the market isn't left open forever.
  for (const [key, pending] of [...this.pendingSettlements.entries()]) {
    if (now - pending.enqueuedAt <= SETTLE_RETRY_GIVE_UP_MS) continue;
    logger.info("housekeep: settlement give-up — final attempt, then void", {
      label: pending.action.label,
      "market.pda": key,
      ageHours: Math.round((now - pending.enqueuedAt) / 3.6e6),
    });

    const attempt = await this.executeAction(pending.action);
    if (attempt.success && attempt.marketPda) {
      this.pendingSettlements.delete(key);
      this.persistPendingSettlements();
      continue;
    }

    const voidAction: AgentAction = {
      type: "void_market",
      predicate: pending.action.predicate,
      label: pending.action.label,
    };
    await this.executeAction(voidAction);
    this.pendingSettlements.delete(key);
    this.persistPendingSettlements();
  }

  // B) Claim sweep over every market this process has touched. Skip in
  //    dry-run (claims move real lamports).
  if (this.config.dryRun) return;
  for (const pda of [...this.knownMarketPdas]) {
    await this.sweepClaims(pda);
    await sleep(2000); // devnet pacing
  }
}

/** Claim the creator bond + held position for one resolved market. */
private async sweepClaims(marketPda: string) {
  const { connection, wallet } = this.config;
  let market;
  try {
    market = await getMarket(connection, new PublicKey(marketPda));
  } catch {
    return; // gone / not a readable Market account
  }
  if (market.status !== "settled" && market.status !== "void") return;
  const marketPk = new PublicKey(marketPda);
  const matchId = market.predicate.matchId;

  if (market.creator === wallet.publicKey.toBase58() && !market.bondClaimed) {
    try {
      const sig = await this.sendClaimIx(buildClaimBondIx(wallet.publicKey, marketPk));
      this.config.onMatchEvent?.({
        occurredAt: Date.now(),
        kind: "bond_claimed",
        label: "housekeep: creator bond claimed",
        matchId,
        marketId: marketPda,
        signature: sig,
        source: "housekeep",
      });
      logger.info("housekeep: claimed creator bond", { "market.pda": marketPda, "tx.signature": sig });
    } catch (err) {
      if (!this.isClaimBenign(err)) logger.warn("housekeep: bond claim failed", { "market.pda": marketPda, error: String(err) });
    }
  }

  const [posPda] = findPositionPda(marketPk, wallet.publicKey);
  const posInfo = await connection.getAccountInfo(posPda);
  if (posInfo) {
    try {
      const sig = await this.sendClaimIx(buildClaimIx(wallet.publicKey, marketPk));
      this.config.onMatchEvent?.({
        occurredAt: Date.now(),
        kind: "claim_refund",
        label: "housekeep: claimed payout/refund",
        matchId,
        marketId: marketPda,
        signature: sig,
        source: "housekeep",
      });
      logger.info("housekeep: claimed position", { "market.pda": marketPda, "tx.signature": sig });
    } catch (err) {
      if (!this.isClaimBenign(err)) logger.warn("housekeep: position claim failed", { "market.pda": marketPda, error: String(err) });
    }
  }
}

private async sendClaimIx(ix: TransactionInstruction): Promise<string> {
  const { connection, wallet } = this.config;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const st = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (st.value[0]?.err) throw new Error(JSON.stringify(st.value[0].err));
  return sig;
}

private isClaimBenign(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /BondAlreadyClaimed|NothingToClaim|NotPositionOwner/.test(s);
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
