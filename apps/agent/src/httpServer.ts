import http from "node:http";
import type { MatchEventLedger } from "./eventLedger";
import type { LiveStore } from "./liveStore";
import type { ReplayManager } from "./replayManager";
import type { OddsTracker } from "./oddsTracker";
import type { Fixture } from "@stoppage/txline";

const DEFAULT_PORT = 8765;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, cache-control",
};

function writeJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export interface HttpServerDeps {
  replayManager?: ReplayManager;
  oddsTracker?: OddsTracker;
  resolveFixture?: (fixtureId: number) => Promise<Fixture | null>;
}

export function startEventHttpServer(ledger: MatchEventLedger, liveStore?: LiveStore, deps: HttpServerDeps = {}) {
  const port = Number(process.env.AGENT_HTTP_PORT) || DEFAULT_PORT;
  const { replayManager, oddsTracker, resolveFixture } = deps;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (path === "/health") {
      writeJson(res, 200, { ok: true, replay: replayManager?.getStatus() ?? { active: false } });
      return;
    }

    // ── Replay control ──────────────────────────────────────────────
    if (path === "/replay/start" && req.method === "POST" && replayManager && resolveFixture) {
      void (async () => {
        try {
          const body = JSON.parse(await readBody(req) || "{}");
          const fixtureId = Number(body.fixtureId);
          if (!Number.isInteger(fixtureId) || fixtureId < 1) {
            writeJson(res, 400, { error: "fixtureId required" });
            return;
          }
          const fixture = await resolveFixture(fixtureId);
          if (!fixture) {
            writeJson(res, 404, { error: `fixture ${fixtureId} not found` });
            return;
          }
          const status = await replayManager.launch(fixture);
          writeJson(res, 200, { status });
        } catch (err) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : "replay launch failed" });
        }
      })();
      return;
    }

    if (path === "/replay/stop" && req.method === "POST" && replayManager) {
      void (async () => {
        await replayManager.stop();
        writeJson(res, 200, { status: replayManager.getStatus() });
      })();
      return;
    }

    if (path === "/replay/status" && replayManager) {
      writeJson(res, 200, { status: replayManager.getStatus() });
      return;
    }

    // ── Odds movement ───────────────────────────────────────────────
    if (path === "/odds/shifts" && oddsTracker) {
      writeJson(res, 200, { shifts: oddsTracker.getShifts() });
      return;
    }

    if (path === "/odds/history" && oddsTracker) {
      const marketId = url.searchParams.get("marketId");
      if (!marketId) { writeJson(res, 400, { error: "marketId required" }); return; }
      writeJson(res, 200, { marketId, points: oddsTracker.getHistory(marketId) });
      return;
    }

    if (path === "/events") {
      const matchId = url.searchParams.get("matchId");
      const allEvents = ledger.readEvents();
      const events = matchId
        ? allEvents.filter((e) => e.matchId === matchId)
        : allEvents;
      writeJson(res, 200, { events, updatedAt: Date.now() });
      return;
    }

    if (path === "/match/phase" && liveStore) {
      const matchId = url.searchParams.get("matchId");
      if (!matchId) { writeJson(res, 400, { error: "matchId required" }); return; }
      const phase = liveStore.getPhase(matchId);
      if (!phase) { writeJson(res, 404, { error: "match not found" }); return; }
      writeJson(res, 200, { phase, recentEvents: liveStore.getRecentEvents(matchId) });
      return;
    }

    if (path === "/events/stream" && liveStore) {
      const matchId = url.searchParams.get("matchId");
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...CORS_HEADERS,
      });

      if (matchId) {
        const phase = liveStore.getPhase(matchId);
        if (phase) {
          res.write(`data: ${JSON.stringify({ type: "init", matchId, phase, recentEvents: liveStore.getRecentEvents(matchId) })}\n\n`);
        }
      }

      liveStore.addClient(res);
      req.on("close", () => liveStore.removeClient(res));
      return;
    }

    writeJson(res, 404, { error: "not found" });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[agent] Event HTTP server listening on port ${port}`);
  });

  return server;
}
