"use client";

import type { MatchEvent } from "@stoppage/sdk";
import { oracleInfoFor } from "@/lib/oracle";

type MarketPhase = "open" | "awaiting_settlement" | "settled" | "void";

interface MatchkeeperStatusProps {
  updatedAt?: number | null;
  marketPhase?: MarketPhase;
  /** Validator program id from the market account (oracle-aware copy). */
  oracle?: string;
  compact?: boolean;
  events?: MatchEvent[];
}

function activityFor(phase?: MarketPhase, oracle?: string) {
  if (phase === "settled") return oracle ? `${oracleInfoFor(oracle).name}-verified settlement recorded` : "Proof-backed settlement recorded";
  if (phase === "void") return "Market voided under program rules";
  if (phase === "awaiting_settlement") return oracleInfoFor(oracle).awaitingActivity;
  return "Watching eligible TxLINE match events";
}

function eventLabel(event: MatchEvent) {
  const prefix: Record<MatchEvent["kind"], string> = {
    txline_observed: "TxLINE",
    market_created: "Market",
    proof_validated: "Proof",
    settlement_confirmed: "Settlement",
    market_voided: "Market",
    action_failed: "Attention",
    position_submitted: "Your position",
    decision_logged: "Decision",
    quote_updated: "Quote",
    inventory_skew: "Inventory",
    housekeep_void: "Housekeeper",
    bond_claimed: "Bond",
    claim_refund: "Claim",
  };
  return `${prefix[event.kind]} · ${event.label}`;
}

export function MatchkeeperStatus({ updatedAt, marketPhase, oracle, compact = false, events = [] }: MatchkeeperStatusProps) {
  const timestamp = updatedAt
    ? `Feed update ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : "Feed connected";

  return (
    <section className={`matchkeeper ${compact ? "matchkeeper-compact" : ""}`} aria-label="Matchkeeper status">
      <div className="matchkeeper-head">
        <div><p className="eyebrow">System actor</p><h2>Matchkeeper <span><i className="live-dot" /> live</span></h2></div>
        <span className="matchkeeper-state">{timestamp}</span>
      </div>
      <p className="matchkeeper-activity"><i /> {activityFor(marketPhase, oracle)}</p>
      {!compact && (events.length ? (
        <ol className="matchkeeper-timeline" aria-label="Recent match activity">
          {events.slice(0, 5).map((event) => {
            const href = event.signature ? `https://explorer.solana.com/tx/${event.signature}?cluster=devnet` : event.marketId ? `https://explorer.solana.com/address/${event.marketId}?cluster=devnet` : null;
            return <li key={event.id}><time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>{href ? <a href={href} target="_blank" rel="noreferrer">{eventLabel(event)} <b>↗</b></a> : <span>{eventLabel(event)}</span>}</li>;
          })}
        </ol>
      ) : (
        // No fabricated timeline rows — an empty feed says so, once.
        <p className="matchkeeper-timeline-empty">No activity recorded for this match yet.</p>
      ))}
      {!compact && <details className="matchkeeper-details">
        <summary>What Matchkeeper can do <span>+</span></summary>
        <p>Matchkeeper is Stoppage&apos;s constrained autonomous agent. It watches TxLINE data, opens eligible markets, and submits settlement only after the required proof path validates on-chain.</p>
        <p>It cannot choose your position, move funds outside the market program, or alter a verified outcome.</p>
      </details>}
    </section>
  );
}
