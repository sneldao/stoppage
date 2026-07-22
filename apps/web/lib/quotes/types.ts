import type { PricingResult, PricingSnapshot } from "@stoppage/sdk";

export interface QuotePayload {
  marketId: string;
  label: string;
  predicateKind: string;
  snapshot: PricingSnapshot;
  result: PricingResult;
  inventorySkew: number;
  ts: number;
}

export interface QuoteHistoryPoint {
  ts: number;
  fairValue: number;
  bid: number;
  ask: number;
  inventorySkew: number;
}
