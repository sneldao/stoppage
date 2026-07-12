#!/usr/bin/env node
/**
 * Program-ID consistency check.
 *
 * The committed keypairs in keys/ are the single source of truth for
 * program IDs. This script asserts every other place an ID appears agrees
 * with them:
 *
 *   - declare_id!() in each program's lib.rs
 *   - Anchor.toml  [programs.localnet] and [programs.devnet]
 *   - packages/sdk/src/programIds.ts
 *
 * Unlike its ancestor in the pir8 repo, this script only ever reads files
 * that are committed to the repo — it can never ENOENT on build artifacts.
 * Run via `npm run check:ids`; it is also the first step of scripts/deploy.sh.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PROGRAMS = ["market", "settlement"];

let failed = false;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed = true;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function canonicalId(program) {
  const keypairPath = path.join(ROOT, "keys", `${program}-keypair.json`);
  if (!fs.existsSync(keypairPath)) {
    console.error(`Missing ${keypairPath} — the source-of-truth keypair is gone.`);
    process.exit(1);
  }
  return execFileSync("solana-keygen", ["pubkey", keypairPath], {
    encoding: "utf8",
  }).trim();
}

for (const program of PROGRAMS) {
  const canonical = canonicalId(program);
  console.log(`${program}: canonical ID ${canonical} (keys/${program}-keypair.json)`);

  // declare_id! in lib.rs
  const libPath = path.join(ROOT, "programs", program, "src", "lib.rs");
  const lib = fs.readFileSync(libPath, "utf8");
  const declared = lib.match(/declare_id!\("([^"]+)"\)/)?.[1];
  if (declared === canonical) ok(`declare_id! in programs/${program}/src/lib.rs`);
  else fail(`declare_id! is ${declared} in programs/${program}/src/lib.rs`);

  // Anchor.toml (every cluster section must agree)
  const anchorToml = fs.readFileSync(path.join(ROOT, "Anchor.toml"), "utf8");
  const tomlIds = [...anchorToml.matchAll(new RegExp(`^${program} = "([^"]+)"`, "gm"))].map(
    (m) => m[1]
  );
  if (tomlIds.length === 0) fail(`no ${program} entry in Anchor.toml`);
  else if (tomlIds.every((id) => id === canonical)) ok(`Anchor.toml (${tomlIds.length} entries)`);
  else fail(`Anchor.toml has ${tomlIds.join(", ")} for ${program}`);

  // SDK constant
  const sdkPath = path.join(ROOT, "packages", "sdk", "src", "programIds.ts");
  const sdk = fs.readFileSync(sdkPath, "utf8");
  const sdkId = sdk.match(new RegExp(`${program.toUpperCase()}_PROGRAM_ID = "([^"]+)"`))?.[1];
  if (sdkId === canonical) ok(`packages/sdk/src/programIds.ts`);
  else fail(`SDK constant is ${sdkId} in packages/sdk/src/programIds.ts`);
}

// Anchor CLI version must match the pinned toolchain, or the generated IDL
// schema can silently diverge from what the SDK expects.
const anchorToml = fs.readFileSync(path.join(ROOT, "Anchor.toml"), "utf8");
const pinned = anchorToml.match(/anchor_version = "([^"]+)"/)?.[1];
try {
  const installed = execFileSync("anchor", ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^anchor-cli\s+/, "");
  if (installed === pinned) ok(`anchor-cli ${installed} matches pinned ${pinned}`);
  else fail(`anchor-cli ${installed} != pinned ${pinned} (Anchor.toml)`);
} catch {
  fail("anchor CLI not found on PATH");
}

if (failed) {
  console.error("\nID drift detected. Fix by running: node scripts/sync-ids.js");
  process.exit(1);
}
console.log("\nAll program-ID sources agree.");
