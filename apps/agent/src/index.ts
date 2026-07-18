/**
 * Stoppage Agent — autonomous market creator + settler.
 *
 * Two modes:
 *   live   — streams from TxLINE SSE, creates/settles markets in real-time
 *   replay — replays a completed match for demo/development
 *
 * Usage:
 *   npx tsx apps/agent/src/index.ts live
 *   npx tsx apps/agent/src/index.ts replay <fixtureId>
 *
 * The agent wallet is supplied via SOLANA_KEYPAIR_PATH (default:
 * ~/.config/solana/id.json). It pays for market creation bonds and
 * settlement transactions.
 */

import * as fs from "fs";
import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { getMarket } from "@stoppage/sdk";
import {
  fetchFixtures,
  fetchHistoricalScores,
  matchIdFromFixture,
  type Fixture,
  type Network,
  type NormalizedEvent,
} from "@stoppage/txline";
import { Agent } from "./loop";
import {
  createLiveSource,
  createReplaySource,
} from "./source";
import { loadCredentials } from "@stoppage/txline";
import type { AgentAction } from "./strategy";
import { createMatchEventLedger } from "./eventLedger";
import { startEventHttpServer } from "./httpServer";
import { LiveStore } from "./liveStore";
import { OddsTracker } from "./oddsTracker";
import { ReplayManager } from "./replayManager";

async function main() {
  const mode = process.argv[2] ?? "replay";
  const fixtureId = process.argv[3] ? Number(process.argv[3]) : 18237038; // France vs Spain semi-final
  const dryRun = !process.argv.includes("--live-tx");

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       Stoppage Autonomous Agent          ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();
  console.log(`Mode: ${mode}`);
  console.log(`Chain actions: ${dryRun ? "DRY-RUN (no txs)" : "LIVE"}`);
  if (mode === "replay") {
    console.log(`Fixture ID: ${fixtureId}`);
  }
  console.log();

  // Load credentials
  const { network, creds } = loadCredentials();
  console.log(`Network: ${network}`);

  // Load wallet
  const walletPath = process.env.SOLANA_KEYPAIR_PATH
    ?? process.env.HOME + "/.config/solana/id.json";
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  console.log(`Agent wallet: ${wallet.publicKey.toBase58()}`);

  if (!dryRun) {
    const balance = await new Connection(clusterApiUrl("devnet")).getBalance(wallet.publicKey);
    console.log(`Balance: ${balance / 1e9} SOL`);
  }
  console.log();

  // Fetch fixtures for the fixture map
  console.log("Fetching fixtures...");
  const fixtures = await fetchFixtures(network, creds);
  const fixtureMap = new Map<number, Fixture>();
  for (const f of fixtures) {
    fixtureMap.set(f.FixtureId, f);
  }
  console.log(`Loaded ${fixtures.length} fixtures`);

  // For replay mode, we need the specific fixture
  let source;
  let replayFixture: Fixture | null = null;
  if (mode === "live") {
    source = createLiveSource(network, creds, fixtureMap);
    console.log("Connected to live TxLINE SSE stream");
  } else {
    // Find the fixture in the map, or create a synthetic one
    replayFixture = fixtureMap.get(fixtureId) ?? null;
    if (!replayFixture) {
      // The semi-final might not be in the current fixtures list (it's past)
      // Create a synthetic fixture from the schedule data
      console.log(`Fixture ${fixtureId} not in current list — using synthetic fixture`);
      replayFixture = {
        FixtureId: fixtureId,
        Sport: "Soccer",
        Country: "International",
        FixtureGroup: "World Cup > Semi-finals",
        StartTime: "2026-07-14T19:00:00Z",
        Participant1: "France",
        Participant2: "Spain",
        Participant1IsHome: true,
        GameState: 1,
      };
    }
    const matchId = matchIdFromFixture(replayFixture);
    console.log(`Replaying: ${replayFixture.Participant1} vs ${replayFixture.Participant2} (${matchId})`);
    source = createReplaySource(network, creds, fixtureId, replayFixture, 1000); // 1000x speed
  }
  console.log();

  // Create the agent
  const ledger = createMatchEventLedger();
  const liveStore = new LiveStore();
  const oddsTracker = new OddsTracker();
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Track running scores by matchId (shared by the primary agent)
  const liveScores = new Map<string, { home: number; away: number; homeTeam: string; awayTeam: string }>();

  const replayManager = new ReplayManager({
    connection,
    wallet,
    dryRun,
    network,
    creds,
    ledger,
    liveStore,
    oddsTracker,
  });

  startEventHttpServer(ledger, liveStore, {
    replayManager,
    oddsTracker,
    resolveFixture: async (fixtureId) => {
      const found = fixtureMap.get(fixtureId);
      if (found) return found;
      // Re-fetch in case the fixture list has rotated since boot.
      try {
        const fresh = await fetchFixtures(network, creds);
        for (const f of fresh) fixtureMap.set(f.FixtureId, f);
      } catch { /* network blip — try synthetic below */ }
      const cached = fixtureMap.get(fixtureId);
      if (cached) return cached;
      // Past fixtures (completed matches) aren't in the live snapshot.
      // Verify the fixture has historical score data, then construct a
      // synthetic Fixture so the replay can proceed. This mirrors the
      // CLI replay mode's fallback for the default semi-final fixture.
      try {
        const scores = await fetchHistoricalScores(network, creds, fixtureId);
        if (!scores || scores.length === 0) return null;
      } catch {
        return null;
      }
      return syntheticFixtureForId(fixtureId);
    },
  });

  const agent = new Agent({
    connection,
    wallet,
    source,
    dryRun,
    txlineNetwork: network,
    txlineCreds: creds,
    onEvent: (event) => {
      if (event.type !== "heartbeat") {
        console.log(`  📡 ${event.type}: ${formatEvent(event)}`);
        ledger.append({
          occurredAt: event.ts,
          kind: "txline_observed",
          label: formatEvent(event),
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

        // Feed the odds tracker with on-chain pool snapshots for markets
        // tied to this match, so the sharp-movement detector has live data.
        for (const open of agent.getOpenMarkets()) {
          if (open.predicate.matchId !== event.matchId || !open.marketPda) continue;
          void getMarket(connection, new PublicKey(open.marketPda))
            .then((market) => {
              if (market.yesPool + market.noPool > 0) {
                oddsTracker.record(open.marketPda!, open.label, market.yesPool, market.noPool);
              }
            })
            .catch(() => { /* account may not be indexed yet */ });
        }
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
      if (result.success) {
        console.log(`  ✅ ${action.type}: ${action.label}`);
        if (result.signature) {
          console.log(`     tx: ${result.signature.slice(0, 32)}...`);
        }
      } else {
        console.log(`  ❌ ${action.type} failed: ${result.error}`);
      }
    },
    onMatchEvent: (event) => ledger.append(event),
  });

  // Register the fixture so the agent can fetch validation proofs
  if (mode === "replay" && replayFixture) {
    const matchId = matchIdFromFixture(replayFixture);
    agent.registerFixture(matchId, fixtureId);
  }
  for (const f of fixtures) {
    agent.registerFixture(matchIdFromFixture(f), f.FixtureId);
  }

  // Start the agent
  await agent.start();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[agent] Shutting down...");
    agent.stop();
    process.exit(0);
  });

  console.log("\n[agent] Running. Press Ctrl+C to stop.\n");
}

function formatEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "match_started":
      return `${event.homeTeam} vs ${event.awayTeam}`;
    case "goal_scored":
      return `${event.team} scored!`;
    case "corner_awarded":
      return `${event.team} corner`;
    case "card_shown":
      return `${event.team} ${event.cardType} card`;
    case "match_ended":
      return `${event.finalScore.home}-${event.finalScore.away}`;
    case "halftime":
      return "halftime";
    case "second_half_started":
      return "second half started";
    default:
      return "";
  }
}

/**
 * Known past World Cup fixtures that may not appear in the live snapshot.
 * Used as a fallback when resolveFixture can't find the fixture in the
 * current list but historical score data confirms it exists.
 */
const PAST_FIXTURES: Record<number, { p1: string; p2: string; startTime: string }> = {
  18237038: { p1: "France", p2: "Spain", startTime: "2026-07-14T19:00:00Z" },
};

function syntheticFixtureForId(fixtureId: number): Fixture | null {
  const known = PAST_FIXTURES[fixtureId];
  if (!known) return null;
  return {
    FixtureId: fixtureId,
    Sport: "Soccer",
    Country: "International",
    FixtureGroup: "World Cup",
    StartTime: known.startTime,
    Participant1: known.p1,
    Participant2: known.p2,
    Participant1IsHome: true,
    GameState: 1,
  };
}

main().catch((e) => {
  console.error("Agent failed:", e);
  process.exit(1);
});
