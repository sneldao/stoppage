#!/usr/bin/env node
/**
 * Rewrite every program-ID reference from the source-of-truth keypairs in
 * keys/. Use this after cloning, after rotating a keypair, or whenever
 * check-ids.js reports drift. Idempotent.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PROGRAMS = ["market", "settlement"];

const ids = {};
for (const program of PROGRAMS) {
  ids[program] = execFileSync(
    "solana-keygen",
    ["pubkey", path.join(ROOT, "keys", `${program}-keypair.json`)],
    { encoding: "utf8" }
  ).trim();
}

// declare_id!() in each lib.rs
for (const program of PROGRAMS) {
  const libPath = path.join(ROOT, "programs", program, "src", "lib.rs");
  const lib = fs.readFileSync(libPath, "utf8");
  const updated = lib.replace(/declare_id!\("[^"]+"\)/, `declare_id!("${ids[program]}")`);
  fs.writeFileSync(libPath, updated);
  console.log(`programs/${program}/src/lib.rs → ${ids[program]}`);
}

// Anchor.toml
const anchorTomlPath = path.join(ROOT, "Anchor.toml");
let anchorToml = fs.readFileSync(anchorTomlPath, "utf8");
for (const program of PROGRAMS) {
  anchorToml = anchorToml.replace(
    new RegExp(`^${program} = "[^"]+"`, "gm"),
    `${program} = "${ids[program]}"`
  );
}
fs.writeFileSync(anchorTomlPath, anchorToml);
console.log("Anchor.toml updated");

// SDK constants
const sdkPath = path.join(ROOT, "packages", "sdk", "src", "programIds.ts");
let sdk = fs.readFileSync(sdkPath, "utf8");
for (const program of PROGRAMS) {
  sdk = sdk.replace(
    new RegExp(`${program.toUpperCase()}_PROGRAM_ID = "[^"]+"`),
    `${program.toUpperCase()}_PROGRAM_ID = "${ids[program]}"`
  );
}
fs.writeFileSync(sdkPath, sdk);
console.log("packages/sdk/src/programIds.ts updated");
