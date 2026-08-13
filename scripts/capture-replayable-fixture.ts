/**
 * capture-replayable-fixture — find finished fixtures inside TxLINE's
 * rolling historical-replay window (~2 weeks to ~6 hours ago) and print
 * the data needed to add them to PAST_FIXTURES in apps/agent/src/index.ts.
 *
 * Usage:
 *   npx tsx scripts/capture-replayable-fixture.ts
 *   npx tsx scripts/capture-replayable-fixture.ts --fixture 18272873
 *   npx tsx scripts/capture-replayable-fixture.ts --competition 33
 *
 * Exit codes:
 *   0 — at least one replayable fixture was found
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

function parseArg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const explicitFixtureId = parseArg("fixture")
    ? Number(parseArg("fixture"))
    : undefined;
  const competitionId = parseArg("competition")
    ? Number(parseArg("competition"))
    : undefined;

  const { network, creds } = loadCredentials();
  console.log(`Network: ${network}`);
  if (competitionId !== undefined && !Number.isFinite(competitionId)) {
    console.error(`--competition must be a number (got ${parseArg("competition")})`);
    process.exit(1);
  }

  console.log("Fetching fixtures snapshot...");
  const fixtures = await fetchFixtures(network, creds);
  console.log(`Loaded ${fixtures.length} fixtures`);

  let candidates: Fixture[];
  if (explicitFixtureId) {
    const f = fixtures.find((x) => x.FixtureId === explicitFixtureId);
    candidates = f ? [f] : [];
    if (candidates.length === 0) {
      console.error(`Fixture ${explicitFixtureId} not found in the current snapshot.`);
      console.error("Probing by ID anyway — the snapshot may have rotated.");
      candidates = [{ FixtureId: explicitFixtureId } as Fixture];
    }
  } else {
    candidates = fixtures.filter(isFixtureFinished);
    if (competitionId !== undefined) {
      candidates = candidates.filter((f) => f.CompetitionId === competitionId);
      console.log(
        `${candidates.length} finished fixture(s) in competition ${competitionId}.`
      );
    } else {
      console.log(`${candidates.length} finished fixture(s) in the snapshot.`);
    }
  }

  if (candidates.length === 0 && !explicitFixtureId) {
    console.error("\nNo finished fixtures in the current snapshot" +
      (competitionId !== undefined ? ` for competition ${competitionId}` : "") +
      ".");
    console.error("Re-run after a covered match finishes, or pass --fixture <id>.");
    process.exit(1);
  }

  // Also list scheduled fixtures in the competition for coverage evidence.
  if (competitionId !== undefined && !explicitFixtureId) {
    const scheduled = fixtures.filter((f) => f.CompetitionId === competitionId);
    console.log(`\nCompetition ${competitionId} snapshot: ${scheduled.length} fixture(s)`);
    const sample = scheduled
      .slice()
      .sort((a, b) => Number(a.StartTime) - Number(b.StartTime))
      .slice(0, 5);
    for (const f of sample) {
      console.log(
        `  ${f.FixtureId}  ${f.Competition ?? "?"}  ${f.Participant1} vs ${f.Participant2}  ` +
          `start=${f.StartTime}  state=${f.GameState}`
      );
    }
    console.log("");
  }

  let found = 0;
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

    const matchId = matchIdFromFixture(fixture);
    const lastUpdate = scores[scores.length - 1];
    const seq = lastUpdate.Seq ?? (lastUpdate as { seq?: number }).seq ?? scores.length;

    let proofOk = false;
    let proofDetail = "";
    let cornersDetail = "";
    try {
      const proof = await fetchStatValidation(network, creds, fixtureId, seq, 1);
      proofOk = true;
      proofDetail = `${proof.statProof.length} stat nodes, goals value=${proof.statToProve.value}`;
    } catch (err) {
      proofDetail = `goals probe failed: ${(err as Error).message.slice(0, 80)}`;
    }
    try {
      const corners = await fetchStatValidation(network, creds, fixtureId, seq, 7);
      cornersDetail = `corners ok, value=${corners.statToProve.value}`;
    } catch (err) {
      cornersDetail = `corners: ${(err as Error).message.slice(0, 60)}`;
    }

    found += 1;
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
    console.log(`  Goals proof:  ${proofOk ? "✓ " + proofDetail : "✗ " + proofDetail}`);
    console.log(`  Corners:      ${cornersDetail}`);
    console.log("");
    console.log("  Paste this into PAST_FIXTURES in apps/agent/src/index.ts:");
    console.log("");
    console.log(
      `  ${fixtureId}: { p1: "${fixture.Participant1 ?? "Home"}", p2: "${fixture.Participant2 ?? "Away"}", startTime: "${fixture.StartTime}" },`
    );
    console.log("");
    console.log("  Then run the replay:");
    console.log(`  npx tsx apps/agent/src/index.ts replay ${fixtureId}`);
    console.log("════════════════════════════════════════════════════════════");
    console.log("");

    // With --fixture, stop after the first (only) candidate report.
    if (explicitFixtureId) break;
  }

  if (found === 0) {
    console.error("\nNo replayable fixture found in the historical window.");
    console.error("The replay API serves fixtures that finished between ~2 weeks");
    console.error("and ~6 hours ago.");
    process.exit(1);
  }

  console.log(`Found ${found} replayable fixture(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("capture-replayable-fixture failed:", e);
  process.exit(1);
});
