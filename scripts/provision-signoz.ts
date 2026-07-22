#!/usr/bin/env npx tsx
/**
 * Provision SigNoz dashboard + alert rules for Matchkeeper.
 *
 * Reads admin credentials from .env.signoz (repo root or SIGNOZ_ENV_PATH).
 * Safe to re-run — upserts dashboard by title, skips existing alert names.
 *
 * Usage:
 *   npx tsx scripts/provision-signoz.ts
 *   SIGNOZ_URL=http://127.0.0.1:9090 npx tsx scripts/provision-signoz.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_PATH = path.join(ROOT, "deploy/signoz/dashboard-matchkeeper.json");
const ALERTS_PATH = path.join(ROOT, "deploy/signoz/alerts-matchkeeper.json");

interface SignozSession {
  accessToken: string;
}

interface ApiEnvelope<T> {
  status: string;
  data?: T;
  error?: { message?: string } | string;
  errorType?: string;
}

function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

const envPath = process.env.SIGNOZ_ENV_PATH ?? path.join(ROOT, ".env.signoz");
const fileEnv = loadEnvFile(envPath);

const SIGNOZ_URL = env("SIGNOZ_URL", "http://127.0.0.1:9090").replace(/\/$/, "");
const SIGNOZ_EMAIL = env("SIGNOZ_EMAIL");
const SIGNOZ_PASSWORD = env("SIGNOZ_PASSWORD");
const SIGNOZ_ORG_ID = env("SIGNOZ_ORG_ID");

async function api<T>(
  token: string,
  method: string,
  route: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${SIGNOZ_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<T> & Record<string, unknown>;
  if (!res.ok || json.status === "error") {
    const msg =
      (json.error as { message?: string } | undefined)?.message
      ?? (json.error as string | undefined)
      ?? res.statusText;
    throw new Error(`${method} ${route}: ${msg}`);
  }
  return json.data as T;
}

async function login(): Promise<string> {
  if (!SIGNOZ_EMAIL || !SIGNOZ_PASSWORD || !SIGNOZ_ORG_ID) {
    throw new Error(
      `Missing SIGNOZ_EMAIL / SIGNOZ_PASSWORD / SIGNOZ_ORG_ID (set in ${envPath})`
    );
  }
  const res = await fetch(`${SIGNOZ_URL}/api/v2/sessions/email_password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: SIGNOZ_EMAIL,
      password: SIGNOZ_PASSWORD,
      orgId: SIGNOZ_ORG_ID,
    }),
  });
  const json = (await res.json()) as ApiEnvelope<SignozSession>;
  if (json.status !== "success" || !json.data?.accessToken) {
    throw new Error(`Login failed: ${JSON.stringify(json)}`);
  }
  return json.data.accessToken;
}

async function upsertDashboard(token: string) {
  const dashboard = JSON.parse(fs.readFileSync(DASHBOARD_PATH, "utf8")) as {
    title: string;
  } & Record<string, unknown>;

  const existing = await api<Array<{ id: string; data: { title: string } }>>(
    token,
    "GET",
    "/api/v1/dashboards"
  );

  const match = existing.find((d) => d.data?.title === dashboard.title);
  if (match) {
    await api(token, "PUT", `/api/v1/dashboards/${match.id}`, dashboard);
    console.log(`Dashboard updated: ${dashboard.title} (${match.id})`);
    return;
  }

  const created = await api<{ id: string }>(token, "POST", "/api/v1/dashboards", dashboard);
  console.log(`Dashboard created: ${dashboard.title} (${created.id})`);
}

async function ensureChannel(token: string, channelSpec: {
  name: string;
  webhook_configs: Array<{ send_resolved: boolean; url: string }>;
}): Promise<string> {
  const channels = await api<Array<{ id: string; name: string }>>(
    token,
    "GET",
    "/api/v1/channels"
  );
  const existing = channels.find((c) => c.name === channelSpec.name);
  if (existing) {
    console.log(`Notification channel exists: ${channelSpec.name}`);
    return channelSpec.name;
  }
  await api(token, "POST", "/api/v1/channels", channelSpec);
  console.log(`Notification channel created: ${channelSpec.name}`);
  return channelSpec.name;
}

async function upsertAlerts(token: string, channelId: string) {
  const config = JSON.parse(fs.readFileSync(ALERTS_PATH, "utf8")) as {
    rules: Array<Record<string, unknown> & { alert: string }>;
  };

  const existing = await api<{ rules: Array<{ alert: string; id: string }> }>(
    token,
    "GET",
    "/api/v1/rules"
  );
  const names = new Set(existing.rules.map((r) => r.alert));

  for (const rule of config.rules) {
    if (names.has(rule.alert)) {
      console.log(`Alert exists, skipping: ${rule.alert}`);
      continue;
    }
    await api(token, "POST", "/api/v1/rules", {
      ...rule,
      ruleType: rule.ruleType ?? "threshold_rule",
      preferredChannels: [channelId],
      disabled: false,
    });
    console.log(`Alert created: ${rule.alert}`);
  }
}

async function main() {
  console.log(`SigNoz: ${SIGNOZ_URL}`);
  const token = await login();
  await upsertDashboard(token);

  const alertsConfig = JSON.parse(fs.readFileSync(ALERTS_PATH, "utf8")) as {
    channel: { name: string; webhook_configs: Array<{ send_resolved: boolean; url: string }> };
  };
  const channelId = await ensureChannel(token, alertsConfig.channel);
  await upsertAlerts(token, channelId);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
