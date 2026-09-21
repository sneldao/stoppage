"use client";

import type { MatchEvent } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import { relTime } from "@/lib/activity/useActivityFeed";

const EXPLORER_TX = "https://explorer.solana.com/tx/";

function lastKeeperAction(activity: MatchEvent[]): MatchEvent | undefined {
  // The merged feed also carries the visitor's own wallet activity —
  // "last action" means the keeper's, not theirs.
  return activity.find((e) => e.source !== "wallet");
}

function latestUsePodAdvisory(activity: MatchEvent[]): MatchEvent | undefined {
  return activity.find(
    (e) => e.kind === "decision_logged" && e.label.startsWith("UsePod advisory")
  );
}

/**
 * AgentStrip — the autonomous operator, visible to every visitor.
 *
 * Matchkeeper is the product (AnsemHack entry, hackathons.md §3), so its
 * presence cannot sit behind wallet connect: stats come from the live
 * market tape, the last action from the keeper ledger feed, and any
 * UsePod advisory decision is shown verbatim — it already carries the
 * x402 payment signature. Every number is real on-chain state, never
 * seeded copy.
 */
export function AgentStrip() {
  const markets = useStoppageStore((s) => s.markets);
  // s.feed is the merged keeper ledger (activityFeedSlice) — s.activity is
  // the visitor's own wallet actions, which is empty for spectators.
  const activity = useStoppageStore((s) => s.feed);

  const list = Object.values(markets);
  const operated = list.length;
  const proven = list.filter((m) => m.status === "settled" && m.verifications > 0).length;
  const attestations = list.reduce((n, m) => n + m.verifications, 0);

  const last = lastKeeperAction(activity);
  const advisory = latestUsePodAdvisory(activity);

  return (
    <section className="agent-strip" aria-label="Autonomous operator">
      <div className="agent-strip-id">
        <span className="agent-strip-name">
          <i className="live-dot" /> MATCHKEEPER
        </span>
        <span className="agent-strip-role">
          autonomous operator — opens, prices &amp; settles every market on this tape
        </span>
      </div>

      <div className="agent-strip-stats">
        <span>
          <b>{operated}</b> markets operated
        </span>
        <span>
          <b>{proven}</b> settled by proof
        </span>
        <span>
          <b>{attestations}</b> on-chain attestations
        </span>
      </div>

      <div className="agent-strip-latest">
        {last ? (
          <span>
            latest · {relTime(last.occurredAt)} ago —{" "}
            {last.signature ? (
              <a
                href={`${EXPLORER_TX}${last.signature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                {last.label} ↗
              </a>
            ) : (
              last.label
            )}
          </span>
        ) : (
          <span>listening for keeper activity…</span>
        )}
        {advisory && (
          <span className="agent-strip-advisory">
            {advisory.label}
            {advisory.signature && (
              <>
                {" · "}
                <a
                  href={`${EXPLORER_TX}${advisory.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  title="x402 payment receipt on Solana mainnet"
                >
                  paid ↗
                </a>
              </>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
