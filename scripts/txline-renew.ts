#!/usr/bin/env node
/**
 * txline-renew — autorenew the TxLINE free/devnet subscription when due.
 *
 * The 4-week free tier lapses silently (07-18 -> expiry ~08-15 last time),
 * which 401'd every keeper proof fetch. This driver makes renewal a routine
 * scheduled call instead of a manual re-run:
 *
 *   - Reads .txline-credentials.json (subscribedAt + durationWeeks) to
 *     compute the deterministic expiry.
 *   - Probes the API: if it 401s OR we're within --days of expiry, renew.
 *   - Renewal runs the exact subscribe flow (scripts/subscribe-txline.ts),
 *     which re-signs with the subscriber wallet and rewrites the creds.
 *   - With --deploy, it then ships the fresh creds to the VPS .env.agent,
 *     restarts stoppage-agent (--update-env), and verifies health.
 *
 * Run it where the subscriber wallet + .txline-credentials.json live (the
 * devnet deployer host). --check previews without renewing. Daily cron on
 * the wallet host keeps the loop tight; combined with scripts/txline-health.ts
 * (on the VPS) nothing lapses silently.
 *
 * Usage:
 *   npx tsx scripts/txline-renew.ts --check
 *   npx tsx scripts/txline-renew.ts                # renew when due (no deploy)
 *   npx tsx scripts/txline-renew.ts --days=10 --deploy
 *
 * Env / opts:
 *   SOLANA_RPC_URL, devnet wallet key must resolve for subscribe-txline.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadCredentials, fetchFixturesForCompetitions } from "@stoppage/txline";

const ROOT = path.resolve(__dirname, "..");
const CRED_PATH = path.join(ROOT, ".txline-credentials.json");
const VPS_HOST = process.env.TXLINE_VPS || "nuncio-vultr";
const VPS_DIR = process.env.TXLINE_VPS_DIR || "/home/linuxuser/stoppage";
const AGENT_PORT = process.env.AGENT_HTTP_PORT || "18766";

const args: Record<string, string | undefined> = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  args[raw.slice(2, eq === -1 ? undefined : eq)] = eq === -1 ? "true" : raw.slice(eq + 1);
}
const days = Math.max(0, Number(args.days ?? "7"));
const deploy = args.deploy === "true" || process.argv.includes("--deploy");
const dryRun = args.deploy === "check" || args["dry-run"] === "true" || args.check === "true";

function log(...m: string[]) { console.log("[txline-renew]", ...m); }

function expiryOf(cfg: { subscribedAt?: string; durationWeeks?: number }): Date {
  const base = cfg.subscribedAt ? new Date(cfg.subscribedAt) : new Date(0);
  const weeks = cfg.durationWeeks ?? 4;
  return new Date(base.getTime() + weeks * 7 * 24 * 3600 * 1000);
}

function syncToVps() {
  const creds = fs.readFileSync(CRED_PATH, "utf8");
  fs.writeFileSync("/tmp/txrefresh.json", creds, { mode: 0o600 });
  log(`scp new creds -> ${VPS_HOST}`);
  execFileSync("scp", ["-q", "/tmp/txrefresh.json", `${VPS_HOST}:/tmp/txrefresh.json`]);
  const remote = [
    "set -euo pipefail",
    `cd ${VPS_DIR}`,
    `python3 - <<'PY'`,
    `import json,re`,
    `c=json.load(open('/tmp/txrefresh.json'))`,
    `env='${VPS_DIR}/.env.agent'`,
    `ls=open(env).read().splitlines()`,
    `def setk(k,v):`,
    `  pat=re.compile(r'^'+re.escape(k)+r'=')`,
    `  for i,x in enumerate(ls):`,
    `    if pat.match(x): ls[i]=f'{k}={v}'; return`,
    `  ls.append(f'{k}={v}')`,
    `setk('TXLINE_NETWORK',c.get('network','devnet'))`,
    `setk('TXLINE_JWT',c['jwt'])`,
    `setk('TXLINE_API_TOKEN',c['apiToken'])`,
    `open(env,'w').write('\\n'.join(ls).rstrip('\\n')+'\\n')`,
    `print('updated TXLINE creds in '+env)`,
    `PY`,
    "rm -f /tmp/txrefresh.json",
    "set -a; source .env.agent; set +a",
    "pm2 restart stoppage-agent --update-env",
    "pm2 save >/dev/null 2>&1 || true",
    "sleep 5",
    `curl -s --max-time 12 http://localhost:${AGENT_PORT}/health; echo`,
  ].join("\n");
  execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", VPS_HOST, "bash", "-s"], { input: remote, stdio: "inherit" });
  fs.rmSync("/tmp/txrefresh.json", { force: true });
}

async function main() {
  if (!fs.existsSync(CRED_PATH)) {
    log("no .txline-credentials.json — run scripts/subscribe-txline.ts first");
    return 1;
  }
  const cfg = JSON.parse(fs.readFileSync(CRED_PATH, "utf8")) as Partial<{
    network: string;
    jwt: string;
    apiToken: string;
    subscribedAt: string;
    durationWeeks: number;
  }>;
  const { network, creds } = loadCredentials();
  const expiry = expiryOf(cfg);
  const daysLeft = (expiry.getTime() - Date.now()) / 86400e3;

  // Probe auth first — a 401 means it already lapsed.
  let probeOk = true;
  let probeErr = "";
  try {
    await fetchFixturesForCompetitions(network as "devnet" | "mainnet", creds, [8, 33]);
  } catch (e) {
    probeOk = false;
    probeErr = String(e);
  }

  const due = !probeOk || daysLeft < days;
  log(`network=${network} · expiry=${expiry.toISOString()} · daysLeft=${daysLeft.toFixed(1)} · due-in=${days}d`);
  log(`probe=${probeOk ? "ok" : probeErr} · due=${due}`);

  if (!due) { log("not due — nothing to do"); return 0; }
  if (dryRun) { log("(preview) would renew + sync"); return 0; }

  log("renewing subscription...");
  execFileSync("npx", ["tsx", "scripts/subscribe-txline.ts"], { cwd: ROOT, stdio: "inherit" });

  if (deploy) {
    log("syncing new creds to VPS and restarting agent...");
    syncToVps();
  }
  log("done.");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });