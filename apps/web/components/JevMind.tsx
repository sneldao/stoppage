"use client";

import type { MarketStatus } from "@stoppage/sdk";
import { ProofPath } from "@/components/ProofPath";
import type { JevMindResponse } from "@/app/api/jev-mind/route";

const BAR_COLOR: Record<string, string> = {
  goal_pressure: "#ffd56a",
  corners_pressure: "#00bfff",
  chaos: "#ff8a5c",
  feed_anomaly: "#ff4444",
};

/**
 * JevMind — the split screen: fast guesses on the left, slow proof on
 * the right. Advisory only: Jev narrates momentum, the proof path
 * verifies, settlement waits for proof. Never gates any transaction.
 */
export function JevMind({
  mind,
  pending,
  status,
  oracle,
  lastSignal,
}: {
  mind: JevMindResponse | null;
  pending: boolean;
  status: MarketStatus;
  oracle?: string;
  lastSignal?: "goal" | "corner" | "card" | null;
}) {
  const reads = mind?.reads ?? [];
  return (
    <section className="jev-mind" aria-label="Jev mind versus proof">
      <div className="jev-mind-head">
        <div>
          <p className="eyebrow">Jev mind · live reads</p>
          <h2>Fast guesses, slow proof.</h2>
        </div>
        <span className={`jev-source jev-source--${mind?.source ?? "idle"}`} aria-live="polite">
          {pending ? "reading…" : mind ? `${mind.source === "jev" ? `jev ${mind.model ?? ""}`.trim() : "heuristic"} · ${mind.latencyMs}ms` : "waiting for feed"}
        </span>
        {lastSignal && (
          <span className="jev-event" aria-live="polite">feed: {lastSignal} → reads refreshed</span>
        )}
      </div>
      <div className="jev-mind-grid">
        <div className="jev-bars" aria-live="polite">
          {reads.length === 0 && <p className="jev-empty">Live reads appear once the feed ticks.</p>}
          {reads.map((read) => (
            <div className="jev-bar-row" key={read.id}>
              <div className="jev-bar-top">
                <strong>{read.label}</strong>
                <span>{Math.round(read.value * 100)}% · conf {Math.round(read.confidence * 100)}%</span>
              </div>
              <div className="jev-bar-track">
                <i
                  className="jev-bar-fill"
                  style={{
                    transform: `scaleX(${Math.min(1, Math.max(0, read.value))})`,
                    background: BAR_COLOR[read.id] ?? "#a6f0b8",
                    opacity: read.id === "feed_anomaly" && read.value < 0.4 ? 0.45 : 1,
                  }}
                />
              </div>
            </div>
          ))}
          <p className="jev-disclaimer">Live reads narrate momentum · markets settle on on-chain proof alone.</p>
        </div>
        <div className="jev-proof">
          <p className="eyebrow">Proof authority · verifies</p>
          <ProofPath status={status} oracle={oracle} />
        </div>
      </div>
    </section>
  );
}
