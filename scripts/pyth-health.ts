#!/usr/bin/env node
/**
 * pyth-health — Hermes credential health probe for the price keeper.
 *
 * Hermes has required Bearer auth since the Pyth Core upgrade
 * (2026-08-26); a lapsed PYTH_API_KEY fails every fetch with 401 and the
 * price keeper then orphan-creates markets that can never settle. Same
 * failure shape as the silent TxLINE lapse — so same probe shape:
 *
 *   1. Reads PYTH_API_KEY (+ optional HERMES_URL, PRICE_FEED_ID).
 *   2. Makes a real authenticated /v2/updates/price/latest call.
 *   3. On success: exit 0, clears any prior alert marker.
 *      On failure (401 / key missing / network): exit 1, appends to an
 *      alert file, and POSTs a webhook notification if ALERT_WEBHOOK_URL
 *      is set.
 *
 * Run on the VPS on a schedule alongside txline-health with the agent's
 * .env.agent creds. No wallet/private key needed — purely a read check.
 *
 * Env:
 *   PYTH_API_KEY         — Pyth Terminal Bearer key (required)
 *   HERMES_URL           — default https://pyth.dourolabs.app/hermes
 *   PRICE_FEED_ID        — default SOL/USD
 *   ALERT_WEBHOOK_URL    — optional JSON webhook to blast on failure
 *   PYTH_HEALTH_LOG      — alert log path (default .runtime/pyth-health.log)
 *
 * Usage: npx tsx scripts/pyth-health.ts
 */

import * as fs from "fs";
import * as path from "path";
import { PYTH_FEED_IDS } from "@stoppage/sdk";

const HERMES = process.env.HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const FEED_ID = process.env.PRICE_FEED_ID ?? PYTH_FEED_IDS["SOL/USD"];
const API_KEY = process.env.PYTH_API_KEY ?? "";
const LOG_PATH = process.env.PYTH_HEALTH_LOG ?? path.resolve(process.cwd(), ".runtime", "pyth-health.log");
const WEBHOOK = process.env.ALERT_WEBHOOK_URL;

async function main(): Promise<number> {
  if (!API_KEY) {
    await report("PYTH_API_KEY is not set — Hermes requires Bearer auth");
    return 1;
  }
  try {
    const res = await fetch(
      `${HERMES}/v2/updates/price/latest?ids[]=${FEED_ID}&parsed=true`,
      { headers: { authorization: `Bearer ${API_KEY}` } }
    );
    if (!res.ok) {
      await report(`Hermes ${res.status}: ${await res.text()}`);
      return 1;
    }
    const j = (await res.json()) as { parsed?: Array<{ id: string }> };
    if (j.parsed?.[0]?.id !== FEED_ID) {
      await report(`Hermes returned no parsed update for feed ${FEED_ID}`);
      return 1;
    }
    console.log(`pyth notice: OK (SOL/USD update via ${HERMES})`);
    try {
      if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH); // clear old alert
    } catch { /* ignore */ }
    return 0;
  } catch (e) {
    await report(`Hermes unreachable: ${e}`);
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
        body: JSON.stringify({ text: line, source: "stoppage-pyth-health" }),
      });
    } catch { /* webhook best-effort */ }
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e);
  process.exit(1);
});
