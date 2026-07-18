import http from "node:http";
import type { MatchEventLedger } from "./eventLedger";

const DEFAULT_PORT = 3001;

export function startEventHttpServer(ledger: MatchEventLedger) {
  const port = Number(process.env.AGENT_HTTP_PORT) || DEFAULT_PORT;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (path === "/events") {
      const matchId = url.searchParams.get("matchId");
      const allEvents = ledger.readEvents();
      const events = matchId
        ? allEvents.filter((e) => e.matchId === matchId)
        : allEvents;

      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ events, updatedAt: Date.now() }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[agent] Event HTTP server listening on port ${port}`);
  });

  return server;
}
