/**
 * HeliusMonitor — real-time on-chain event bridge.
 *
 * Ported from pir8 src/lib/integrations.ts and generalized:
 *   - uses the browser-native WebSocket (no `ws` package)
 *   - watches a configurable account list instead of a hardcoded program
 *   - log parsing is injected via `eventMatchers` instead of hardcoded
 *     game-event names
 *
 * For Stoppage this becomes the settlement/odds tick stream: subscribe to
 * the market + settlement program IDs and map program log lines
 * ("MarketCreated", "PositionOpened", "MarketSettled") to store updates.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface HeliusEvent {
  /** The matcher name that fired, e.g. "MarketSettled". */
  name: string;
  /** The raw log line that matched. */
  log: string;
  /** Transaction signature, when present in the notification. */
  signature?: string;
  /** Full raw notification payload for consumers that need more. */
  raw: unknown;
}

export interface HeliusMonitorConfig {
  /** Full https Helius RPC URL (converted to wss internally). */
  rpcUrl: string;
  /** Accounts (program IDs, vault PDAs, ...) to watch. */
  accountInclude: string[];
  /** Log substrings to surface as events, e.g. ["MarketCreated", "MarketSettled"]. */
  eventMatchers: string[];
  onEvent: (event: HeliusEvent) => void;
  logLevel?: LogLevel;
}

const LOG_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export class HeliusMonitor {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private lastErrorAt = 0;
  private readonly errorThrottleMs = 30_000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;

  constructor(private readonly config: HeliusMonitorConfig) {}

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      this.log("warn", "WebSocket already connected or connecting");
      return;
    }

    if (!this.config.rpcUrl || this.config.rpcUrl.includes("YOUR_API_KEY")) {
      throw new Error("Helius RPC URL not configured");
    }

    this.closedByUser = false;
    const wsUrl = this.config.rpcUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.log("info", "Helius WebSocket connected");
      this.reconnectAttempts = 0;
      if (!this.pingInterval) {
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(
                JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" })
              );
            } catch {}
          }
        }, 60_000);
      }
      this.subscribe();
    };

    this.ws.onmessage = (event) => {
      try {
        const dataStr =
          typeof event.data === "string" ? event.data : String(event.data);
        const data = JSON.parse(dataStr);
        this.processNotification(data);
      } catch {
        this.log("error", "Failed to parse Helius message");
      }
    };

    this.ws.onclose = () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      if (!this.closedByUser) {
        this.log("warn", "Helius WebSocket disconnected");
        this.handleReconnect();
      }
    };

    this.ws.onerror = () => {
      const now = Date.now();
      if (now - this.lastErrorAt > this.errorThrottleMs) {
        this.lastErrorAt = now;
        this.log("error", "Helius WebSocket error");
      }
    };
  }

  private subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "transactionSubscribe",
      params: [
        {
          vote: false,
          failed: false,
          signature: null,
          accountInclude: this.config.accountInclude,
        },
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          showRewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ],
    };

    try {
      this.ws.send(JSON.stringify(subscribeMessage));
    } catch {}
    this.log(
      "debug",
      `Subscribed to ${this.config.accountInclude.length} account(s)`
    );
  }

  private processNotification(data: any) {
    const value = data?.params?.result?.value ?? data?.result?.value;
    if (!value) return;

    const logs: string[] = value?.meta?.logMessages ?? [];
    const signature: string | undefined = value?.signature;

    for (const log of logs) {
      for (const name of this.config.eventMatchers) {
        if (log.includes(name)) {
          this.config.onEvent({ name, log, signature, raw: data });
        }
      }
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000;
      setTimeout(() => {
        this.log(
          "warn",
          `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );
        this.connect();
      }, delay);
    }
  }

  disconnect() {
    this.closedByUser = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private log(level: Exclude<LogLevel, "silent">, message: string) {
    const configured = this.config.logLevel ?? "error";
    if (LOG_ORDER[level] <= LOG_ORDER[configured]) {
      if (level === "error") console.error(`[Helius] ${message}`);
      else if (level === "warn") console.warn(`[Helius] ${message}`);
      else console.log(`[Helius] ${message}`);
    }
  }
}
