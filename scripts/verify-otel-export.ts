#!/usr/bin/env npx tsx
/**
 * Smoke-test OpenTelemetry export without Docker/SigNoz.
 * Starts a minimal OTLP HTTP receiver, runs a short agent replay, asserts payloads.
 *
 * Usage: npx tsx scripts/verify-otel-export.ts
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4318;
let tracePosts = 0;
let metricPosts = 0;

const server = http.createServer((req, res) => {
  if (
    req.method === "POST"
    && (req.url === "/v1/traces" || req.url === "/v1/metrics")
  ) {
    if (req.url === "/v1/traces") tracePosts += 1;
    else metricPosts += 1;
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }
  res.writeHead(404);
  res.end();
});

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`OTLP mock receiver listening on http://127.0.0.1:${PORT}`);

  const agent = spawn(
    "npx",
    ["tsx", "apps/agent/src/index.ts", "replay", "18237038"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${PORT}`,
        OTEL_SERVICE_NAME: "stoppage-agent",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let agentErr = "";
  agent.stderr?.on("data", (chunk: Buffer) => {
    agentErr += chunk.toString();
  });

  // Replay runs fast; match_started + create_market should emit trace batches.
  await sleep(15_000);
  agent.kill("SIGINT");

  await new Promise<void>((resolve) => {
    agent.on("close", () => resolve());
    setTimeout(resolve, 3000);
  });

  // Allow batched trace exporter to flush.
  await sleep(3_000);

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  console.log(`Trace exports: ${tracePosts}, metric exports: ${metricPosts}`);

  if (tracePosts === 0) {
    console.error("FAIL: no /v1/traces payloads received");
    if (agentErr) console.error(agentErr.slice(-2000));
    process.exit(1);
  }

  console.log("OK: OpenTelemetry trace export verified");
  if (metricPosts === 0) {
    console.log("Note: no metric batches yet (30s export interval)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
