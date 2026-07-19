"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { impliedProbability, type Market, type Position } from "@stoppage/sdk";
import { formatMarketQuestion } from "@/lib/format";
import { useStoppageStore } from "@/store";

interface Alert {
  id: string;
  marketId: string;
  label: string;
  direction: "up" | "down";
}

const THRESHOLD = 0.10; // 10 percentage points
const ALERT_COOLDOWN_MS = 60_000;

export function OddsMovementAlerts() {
  const { publicKey } = useWallet();
  const markets = useStoppageStore((s) => s.markets);
  const positions = useStoppageStore((s) => s.positions);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const lastAlertRef = useRef<Record<string, number>>({});
  const prevOddsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!publicKey) return;

    const owner = publicKey.toBase58();
    const open = Object.values(positions).filter((p) => {
      if (p.owner !== owner || p.amountLamports <= 0) return false;
      const m = markets[p.marketId];
      return m?.status === "open";
    });

    // Clean up refs for positions that are no longer open.
    const activeKeys = new Set(open.map((p) => `${p.marketId}:${p.side}`));
    for (const key of Object.keys(prevOddsRef.current)) {
      if (!activeKeys.has(key)) {
        delete prevOddsRef.current[key];
        delete lastAlertRef.current[key];
      }
    }

    const newAlerts: Alert[] = [];
    const now = Date.now();

    for (const pos of open) {
      const market = markets[pos.marketId];
      if (!market) continue;

      const odds = impliedProbability(market);
      const current = odds[pos.side];
      const key = `${pos.marketId}:${pos.side}`;
      const previous = prevOddsRef.current[key] ?? current;
      prevOddsRef.current[key] = current;

      const delta = current - previous;
      const absDelta = Math.abs(delta);
      const lastAlert = lastAlertRef.current[key] ?? 0;

      if (absDelta >= THRESHOLD && now - lastAlert > ALERT_COOLDOWN_MS) {
        lastAlertRef.current[key] = now;
        newAlerts.push({
          id: `${key}:${now}`,
          marketId: pos.marketId,
          label: formatMarketQuestion(market.predicate),
          direction: delta > 0 ? "up" : "down",
        });
      }
    }

    if (newAlerts.length > 0) {
      setAlerts((prev) => [...newAlerts, ...prev].slice(0, 4));
    }
  }, [publicKey, markets, positions]);

  const dismiss = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  if (alerts.length === 0) return null;

  return (
    <div className="odds-movement-alerts" aria-live="polite">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`odds-movement-alert odds-movement-alert--${alert.direction}`}
          role="status"
        >
          <span className="odds-movement-alert-badge">
            {alert.direction === "up" ? "📈" : "📉"} Odds {alert.direction}
          </span>
          <span className="odds-movement-alert-text">{alert.label}</span>
          <Link href={`/markets/${alert.marketId}`} className="odds-movement-alert-link">
            View
          </Link>
          <button
            type="button"
            onClick={() => dismiss(alert.id)}
            className="odds-movement-alert-dismiss"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
