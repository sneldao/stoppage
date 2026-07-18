import http from "node:http";
import type { MatchEventLedger } from "./eventLedger";
import type { LiveStore } from "./liveStore";

const DEFAULT_PORT = 8765;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, cache-control",
};

function writeJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

export function startEventHttpServer(ledger: MatchEventLedger, liveStore?: LiveStore) {
  const port = Number(process.env.AGENT_HTTP_PORT) || DEFAULT_PORT;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (path === "/health") {
      writeJson(res, 200, { ok: true });
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
