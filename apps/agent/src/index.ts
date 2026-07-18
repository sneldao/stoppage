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
  startEventHttpServer(ledger);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
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

main().catch((e) => {
  console.error("Agent failed:", e);
  process.exit(1);
});
