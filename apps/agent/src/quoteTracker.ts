/**
 * Quote tracker — the agent's live verifiable pricing line.
 *
 * On every TxLINE state change the loop re-prices each open market via the
 * quant model and records the result here. The HTTP server reads the latest
 * fair value / bid / ask for the focused market, and streams quote_updated
 * facts to the web timeline. This is Phase 3A: the agent as a verifiable
 * reference oracle (not yet the counter-party — that's 3B).
 *
 * Pure-ish: no chain calls. Holds in-memory state + an SSE client set.
 */

import type { PricingResult, PricingSnapshot } from "@stoppage/sdk";

export interface QuotePoint {
  ts: number;
  fairValue: number;
  bid: number;
  ask: number;
  /** Inventory skew 0..1 (1 = fully short YES). Phase 3B feeds this. */
  inventorySkew: number;
}

export interface MarketQuote {
  marketId: string;
  label: string;
  predicateKind: string;
  snapshot: PricingSnapshot;
  result: PricingResult;
  inventorySkew: number;
  ts: number;
}

const MAX_POINTS = 240;
const MAX_QUOTES = 40;

export class QuoteTracker {
  private history = new Map<string, QuotePoint[]>();
  private latest = new Map<string, MarketQuote>();
  private labels = new Map<string, string>();
  private sseClients = new Set<import("node:http").ServerResponse>();

  /** Record a fresh quote for a market. */
  record(quote: MarketQuote): void {
    this.latest.set(quote.marketId, quote);
    this.labels.set(quote.marketId, quote.label);
    const buf = this.history.get(quote.marketId) ?? [];
    buf.push({
      ts: quote.ts,
      fairValue: quote.result.fairValue,
      bid: quote.result.bid,
      ask: quote.result.ask,
      inventorySkew: quote.inventorySkew,
    });
    if (buf.length > MAX_POINTS) buf.shift();
    this.history.set(quote.marketId, buf);
    this.broadcast(quote);
  }

  getLatest(marketId: string): MarketQuote | undefined {
    return this.latest.get(marketId);
  }

  getAllLatest(): MarketQuote[] {
    return [...this.latest.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_QUOTES);
  }

  /** Re-pricing history for a market (sparkline source). */
  getHistory(marketId: string): QuotePoint[] {
    return this.history.get(marketId) ?? [];
  }

  getLabel(marketId: string): string | undefined {
    return this.labels.get(marketId);
  }

  addClient(res: import("node:http").ServerResponse): void {
    this.sseClients.add(res);
    res.on("close", () => this.sseClients.delete(res));
  }

  removeClient(res: import("node:http").ServerResponse): void {
    this.sseClients.delete(res);
  }

  private broadcast(quote: MarketQuote): void {
    const payload = `data: ${JSON.stringify({ type: "quote", quote })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}
