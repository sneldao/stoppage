/**
 * capture-replayable-fixture — find a finished fixture inside TxLINE's
 * rolling historical-replay window (~2 weeks to ~6 hours ago) and print
 * the data needed to add it to PAST_FIXTURES in apps/agent/src/index.ts.
 *
 * The replay window is rolling: World Cup fixtures have aged out, and the
 * free tier only covers International Friendlies. This script is meant to
 * be run the day a covered Friendly finishes (or any time a match is in
 * window) so the replay demo has a known-good target without guessing.
 *
 * What it does:
 *   1. Loads TxLINE credentials (same loader as the agent).
 *   2. Fetches the fixtures snapshot and filters to finished matches.
 *   3. For each finished fixture, probes the historical-scores endpoint
 *      for replay data. The first one with data wins.
 *   4. Prints the fixture details, the score-update count, and a sample
 *      seq + statKey suitable for a stat-validation probe — the exact
 *      values the agent's settle path needs.
 *   5. Prints a ready-to-paste PAST_FIXTURES entry.
 *
 * Usage:
 *   npx tsx scripts/capture-replayable-fixture.ts
 *   npx tsx scripts/capture-replayable-fixture.ts --fixture 18272873
 *
 * Exit codes:
 *   0 — a replayable fixture was found and printed
 *   1 — no replayable fixture is currently in window
 */

import {
  fetchFixtures,
  fetchHistoricalScores,
  fetchStatValidation,
  isFixtureFinished,
  loadCredentials,
  matchIdFromFixture,
  type Fixture,
} from "@stoppage/txline";

async function main() {
  const explicitFixtureId = process.argv.includes("--fixture")
    ? Number(process.argv[process.argv.indexOf("--fixture") + 1])
    : undefined;

  const { network, creds } = loadCredentials();
  console.log(`Network: ${network}`);

  console.log("Fetching fixtures snapshot...");
  const fixtures = await fetchFixtures(network, creds);
  console.log(`Loaded ${fixtures.length} fixtures`);

  // Candidate set: an explicit fixture, or all finished fixtures.
  let candidates: Fixture[];
  if (explicitFixtureId) {
    const f = fixtures.find((x) => x.FixtureId === explicitFixtureId);
    candidates = f ? [f] : [];
    if (candidates.length === 0) {
      console.error(`Fixture ${explicitFixtureId} not found in the current snapshot.`);
      console.error("The snapshot only lists upcoming/current matches. If the fixture");
      console.error("is finished and in the replay window, pass its ID and we'll probe it directly.");
      // Fall through to probe by ID anyway — the snapshot may have rotated.
      candidates = [{ FixtureId: explicitFixtureId } as Fixture];
    }
  } else {
    candidates = fixtures.filter(isFixtureFinished);
    console.log(`${candidates.length} finished fixture(s) in the snapshot.`);
  }

  if (candidates.length === 0 && !explicitFixtureId) {
    console.error("\nNo finished fixtures in the current snapshot.");
    console.error("The free tier covers International Friendlies; the next window of");
    console.error("finished matches opens when a covered match completes. Check the");
    console.error("fixtures snapshot for upcoming matches and re-run after one finishes.");
    process.exit(1);
  }

  // Probe each candidate for historical replay data.
  for (const fixture of candidates) {
    const fixtureId = fixture.FixtureId;
    process.stdout.write(`  fixture ${fixtureId}... `);
    let scores;
    try {
      scores = await fetchHistoricalScores(network, creds, fixtureId);
    } catch (err) {
      console.log(`historical fetch failed: ${(err as Error).message}`);
      continue;
    }
    if (!scores || scores.length === 0) {
      console.log("no historical data (out of replay window or not yet started)");
      continue;
    }
    console.log(`${scores.length} score updates ✓`);

    // Found a replayable fixture. Capture the details.
    const matchId = matchIdFromFixture(fixture);
    const lastUpdate = scores[scores.length - 1];
    const seq = lastUpdate.Seq ?? lastUpdate.seq ?? scores.length;

    // Probe a stat-validation proof for the final seq + P1Goals (statKey 1)
    // so we know the proof path works end-to-end for this fixture.
    let proofOk = false;
    let proofDetail = "";
    try {
      const proof = await fetchStatValidation(network, creds, fixtureId, seq, 1);
      proofOk = true;
      proofDetail = `${proof.statProof.length} stat nodes, value=${proof.statToProve.value}`;
    } catch (err) {
      proofDetail = `probe failed: ${(err as Error).message.slice(0, 80)}`;
    }

    console.log("");
    console.log("════════════════════════════════════════════════════════════");
    console.log("  REPLAYABLE FIXTURE FOUND");
    console.log("════════════════════════════════════════════════════════════");
    console.log(`  FixtureId:    ${fixtureId}`);
    console.log(`  Match:        ${fixture.Participant1 ?? "?"} vs ${fixture.Participant2 ?? "?"}`);
    console.log(`  matchId:      ${matchId}`);
    console.log(`  Competition:  ${fixture.Competition ?? "?"} (${fixture.CompetitionId ?? "?"})`);
    console.log(`  StartTime:    ${fixture.StartTime}`);
    console.log(`  GameState:    ${fixture.GameState}`);
    console.log(`  Score updates: ${scores.length}`);
    console.log(`  Final seq:    ${seq}`);
    console.log(`  Proof probe:  ${proofOk ? "✓ " + proofDetail : "✗ " + proofDetail}`);
    console.log("");
    console.log("  Paste this into PAST_FIXTURES in apps/agent/src/index.ts:");
    console.log("");
    console.log(`  ${fixtureId}: { p1: "${fixture.Participant1 ?? "Home"}", p2: "${fixture.Participant2 ?? "Away"}", startTime: "${fixture.StartTime}" },`);
    console.log("");
    console.log("  Then run the replay:");
    console.log(`  npx tsx apps/agent/src/index.ts replay ${fixtureId}`);
    console.log("════════════════════════════════════════════════════════════");
    process.exit(0);
  }

  console.error("\nNo replayable fixture found in the historical window.");
  console.error("The replay API serves fixtures that finished between ~2 weeks");
  console.error("and ~6 hours ago. Options:");
  console.error("  - Wait for a covered match to finish and re-run this script.");
  console.error("  - Check the fixtures snapshot for upcoming matches.");
  process.exit(1);
}

main().catch((e) => {
  console.error("capture-replayable-fixture failed:", e);
  process.exit(1);
});
