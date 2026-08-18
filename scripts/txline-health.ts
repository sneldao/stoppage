#!/usr/bin/env node
/**
 * txline-health — credential health probe for the TxLINE API.
 *
 * The 2026-08-15 outage was exact**: the free 28-day subscription lapsed
 * silently (subscribedAt 07-18 -> expiry ~08-15) and every keeper proof
 * fetch started returning 401. Nothing noticed for days. This probe makes
 * that failure loud:
 *
 *   1. Loads TxLINE creds (env TXLINE_* or .txline-credentials.json).
 *   2. Makes a real authenticated call (fixtures snapshot).
 *   3. On success: exit 0, clears any prior alert marker.
 *      On failure (401 / creds missing / network): exit 1, appends to an
 *      alert file, and POSTs a webhook notification if ALERT_WEBHOOK_URL
 *      is set (Slack/Discord/anything accepting {toxi: JSON).
 *
 * Run on the VPS on a schedule (see crontab in docs) with the agent's
 * .env.agent creds. No wallet/private key needed — purely a read check.
 *
 * Env:
 *   SOLANA_RPC_URL       — unused here (no on-chain calls)
 *   ALERT_WEBHOOK_URL    — optional JSON webhook to blast on failure
 *   TXLINE_HEALTH_LOG    — alert log path (default .runtime/txline-health.log)
 *
 * Usage: npx tsx scripts/txline-health.ts
 */

import * as fs from "fs";
import * as path from "path";
import { loadCredentials, fetchFixturesForCompetitions } from "@stoppage/txline";

const LOG_PATH = process.env.TXLINE_HEALTH_LOG ?? path.resolve(process.cwd(), ".runtime", "txline-health.log");
const WEBHOOK = process.env.ALERT_WEBHOOK_URL;

async function main(): Promise<number> {
  let network: string;
  try {
    ({ network } = loadCredentials());
  } catch (e) {
    await report(`credentials unavailable: ${e}`);
    return 1;
  }

  try {
    // A lightweight auth-gated call: 401/403 => the creds have lapsed.
    const fixtures = await fetchFixturesForCompetitions(network as "devnet" | "mainnet", loadCredentials().creds, [8, 33]);
    console.log(`txline notice: OK (${fixtures.length} fixtures · ${network})`);
    try {
      if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH); // clear old alert
    } catch { /* ignore */ }
    return 0;
  } catch (e) {
    await report(`TxLINE auth/API failure: ${e}`);
    return 1;
  }
}

async function report(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  console.error(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + "\n", { encoding: "utf8" });
  } catch { /* alert log best-effort */ }
  if (WEBHOOK) {
    try {
      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line, source: "stoppage-txline-health" }),
      });
    } catch { /* webhook best-effort */ }
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e);
  process.exit(1);
});