"use client";

import { useEffect, useState } from "react";
import type { MarketStatus } from "@stoppage/sdk";

function remainingLabel(closesAt: string, now: number) {
  const remaining = Math.max(0, new Date(closesAt).getTime() - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  if (totalSeconds <= 0) return "Closing";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

export function MarketWindow({ closesAt, status, compact = false }: { closesAt: string; status: MarketStatus; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "open") return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const remaining = new Date(closesAt).getTime() - now;
  const state = status === "open" ? remaining <= 30_000 ? "Closing now" : remaining <= 120_000 ? "Closing soon" : "Window live" : status === "awaiting_settlement" ? "Validation waiting" : status === "settled" ? "Settled" : "Voided";
  const label = status === "open" ? remainingLabel(closesAt, now) : status === "awaiting_settlement" ? "Proof required" : status === "settled" ? "Result recorded" : "Refund path";

  return <div className={`market-window market-window-${status} ${compact ? "market-window-compact" : ""}`}><span>{state}</span><strong>{label}</strong>{!compact && <small>{status === "open" ? "Position window" : "Market lifecycle"}</small>}</div>;
}
