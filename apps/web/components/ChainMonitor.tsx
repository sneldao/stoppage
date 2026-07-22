"use client";

import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";

/** Single app-wide Helius subscription — avoids reconnect churn on route changes. */
export function ChainMonitor() {
  useHeliusMonitor();
  return null;
}
