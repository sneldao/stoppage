/**
 * Replay manager — turns the agent's replay source into a product.
 *
 * Lets the web app launch a replay of any completed fixture through the
 * exact live pipeline (normalizer → strategy → markets → SSE → proofs),
 * so the full experience is demonstrable on demand even after the
 * tournament's live matches end. One replay at a time; launching a new
 * one stops the previous.
 *
 * The replay source is identical to live mode downstream — the agent
 * loop, LiveStore, event ledger, and odds tracker cannot tell the
 * difference, which is precisely what makes it a faithful demo.
 */

import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import { getMarket } from "@stoppage/sdk";
import {
  fetchHistoricalScores,
  isFixtureFinished,
  matchIdFromFixture,
  type Fixture,
  type Network,
  type TxLineCredentials,
  type NormalizedEvent,
} from "@stoppage/txline";
import { Agent } from "./loop";
import { createReplaySource } from "./source";
import type { AgentAction } from "./strategy";
import type { MatchEventLedger } from "./eventLedger";
import type { LiveStore } from "./liveStore";
import type { OddsTracker } from "./oddsTracker";
import type { EventSource } from "./source";

export interface ReplayStatus {
  active: boolean;
  fixtureId?: number;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  startedAt?: number;
  finished?: boolean;
}

export class ReplayDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayDataError";
  }
}

export interface ReplayDeps {
  connection: Connection;
  wallet: Keypair;
  dryRun: boolean;
  network: Network;
  creds: TxLineCredentials;
  ledger: MatchEventLedger;
  liveStore: LiveStore;
  oddsTracker: OddsTracker;
}

export class ReplayManager {
  private current: { agent: Agent; source: EventSource } | null = null;
  private status: ReplayStatus = { active: false };
  private trackedMarkets = new Map<string, string>(); // marketPda → label
  private oddsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: ReplayDeps) {}

  getStatus(): ReplayStatus {
    return { ...this.status };
  }

  /** Launch a replay for a fixture. Stops any in-flight replay. */
  async launch(fixture: Fixture): Promise<ReplayStatus> {
    await this.stop();

    const { connection, wallet, dryRun, network, creds, ledger, liveStore, oddsTracker } = this.deps;
    const fixtureId = fixture.FixtureId;
    const matchId = matchIdFromFixture(fixture);

    if (!isFixtureFinished(fixture)) {
      throw new ReplayDataError(`Fixture ${fixtureId} is not in a finished state`);
    }

    // Verify the fixture has historical data worth replaying.
    const scores = await fetchHistoricalScores(network, creds, fixtureId);
    if (!scores || scores.length === 0) {
      throw new ReplayDataError(`No historical score data for fixture ${fixtureId}`);
    }

    // ~20x speed: a full match replays in a few minutes, fast enough for a
    // demo while keeping the event cadence readable on screen.
    const source = createReplaySource(network, creds, fixtureId, fixture, 20);

    const liveScores = new Map<string, { home: number; away: number; homeTeam: string; awayTeam: string }>();

    const agent = new Agent({
      connection,
      wallet,
      source,
      dryRun,
      txlineNetwork: network,
      txlineCreds: creds,
      onEvent: (event: NormalizedEvent) => {
        if (event.type === "heartbeat") return;
        ledger.append({
          occurredAt: event.ts,
          kind: "txline_observed",
          label: replayEventLabel(event),
          matchId: event.matchId,
          fixtureId: event.fixtureId,
          source: "txline",
        });
        if (!liveScores.has(event.matchId) && event.type === "match_started") {
          liveScores.set(event.matchId, { home: 0, away: 0, homeTeam: event.homeTeam, awayTeam: event.awayTeam });
        }
        const score = liveScores.get(event.matchId);
        if (score) {
          if (event.type === "goal_scored" && event.team === score.homeTeam) score.home++;
          if (event.type === "goal_scored" && event.team === score.awayTeam) score.away++;
          if (event.type === "match_ended") { score.home = event.finalScore.home; score.away = event.finalScore.away; }
          liveStore.updateFromEvent(event, score.homeTeam, score.awayTeam, { home: score.home, away: score.away });
        }
        if (event.type === "match_ended") {
          this.status = { ...this.status, finished: true };
        }
      },
      onAction: (action: AgentAction, result) => {
        const kind = !result.success ? "action_failed" : action.type === "create_market" ? "market_created" : action.type === "settle_market" ? "settlement_confirmed" : "market_voided";
        ledger.append({
          occurredAt: Date.now(),
          kind,
          label: result.success ? action.label : `${action.label} failed: ${result.error ?? "unknown error"}`,
          matchId: action.predicate.matchId,
          marketId: result.marketPda,
          signature: result.signature,
          source: result.signature ? "solana" : "matchkeeper",
        });
        // Track open market pools for odds movement.
        if (result.success && result.marketPda && action.type === "create_market") {
          this.trackedMarkets.set(result.marketPda, action.label);
        }
        if (result.success && result.marketPda && action.type !== "create_market") {
          this.trackedMarkets.delete(result.marketPda);
        }
      },
      onMatchEvent: (event) => ledger.append(event),
    });

    agent.registerFixture(matchId, fixtureId);

    this.status = {
      active: true,
      fixtureId,
      matchId,
      homeTeam: fixture.Participant1,
      awayTeam: fixture.Participant2,
      startedAt: Date.now(),
      finished: false,
    };

    // Fire and forget: the source drives events asynchronously.
    void agent.start().catch((err) => {
      console.error("[replay] agent error:", err);
      this.status = { ...this.status, active: false };
    });

    this.current = { agent, source };
    this.startOddsPolling(connection, oddsTracker);
    console.log(`[replay] Launched replay for ${fixture.Participant1} vs ${fixture.Participant2} (${matchId}, ${scores.length} updates)`);
    return this.getStatus();
  }

  /** Poll tracked markets' on-chain pools to feed the odds tracker. */
  private startOddsPolling(connection: Connection, oddsTracker: OddsTracker): void {
    this.stopOddsPolling();
    this.oddsTimer = setInterval(() => {
      for (const [pda, label] of this.trackedMarkets) {
        void getMarket(connection, new PublicKey(pda))
          .then((market) => {
            if (market.yesPool + market.noPool > 0) {
              oddsTracker.record(pda, label, market.yesPool, market.noPool);
            }
          })
          .catch(() => { /* market may not exist yet on-chain */ });
      }
    }, 10_000);
  }

  private stopOddsPolling(): void {
    if (this.oddsTimer) {
      clearInterval(this.oddsTimer);
      this.oddsTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopOddsPolling();
    if (this.current) {
      this.current.agent.stop();
      this.current = null;
    }
    this.trackedMarkets.clear();
    this.status = { active: false };
  }
}

function replayEventLabel(event: NormalizedEvent): string {
  switch (event.type) {
    case "match_started": return `${event.homeTeam} vs ${event.awayTeam}`;
    case "goal_scored": return `${event.team} scored!`;
    case "corner_awarded": return `${event.team} corner`;
    case "card_shown": return `${event.team} ${event.cardType} card`;
    case "match_ended": return `${event.finalScore.home}-${event.finalScore.away}`;
    case "halftime": return "halftime";
    case "second_half_started": return "second half started";
    default: return event.type.replace(/_/g, " ");
  }
}
