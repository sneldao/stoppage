"use client";

import Link from "next/link";
import { useMemo } from "react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";
import { useFixtures, useFixtureScore } from "@/lib/match/useFixtures";
import { useAttestEvent } from "@/lib/match/useAttestEvent";
import { oracleInfoFor } from "@/lib/oracle";
import { formatMarketQuestion } from "@/lib/format";
import { useCountdown } from "@/lib/time/useCountdown";
import {
  keystoneMarketIds,
  keystonePhase,
  keystoneTimes,
  KEYSTONE,
  KEYSTONE_TXLINE_PREDICATE,
  KEYSTONE_ATTEST_PREDICATE,
} from "@/lib/campaign/keystone";
import { NotifyForm } from "@/components/NotifyForm";
import { MatchPulse } from "@/components/MatchPulse";
import { ElectricBorder } from "@/components/ElectricBorder";

/**
 * /keystone — the campaign surface for Aug 15: Orlando City vs FC
 * Cincinnati, one fixture settling through two different proof paths.
 * All facts (predicates, PDAs, timestamps, phases) come from
 * lib/campaign/keystone.ts — this page only composes them.
 */

const PHASE_COPY = {
  countdown: {
    label: "Betting opens Saturday 21:30 UTC",
    copy: "Two markets on one match open together. Get on the list and you'll be there when the slips go live.",
  },
  betting_open: {
    label: "Betting is open",
    copy: "Both slips are live — 2 hours to kickoff. Devnet SOL; faucet is free.",
  },
  in_play: {
    label: "In play",
    copy: "The match is on. Every position below settles only after a proof verifies on-chain — no admin key decides anything.",
  },
  awaiting_receipts: {
    label: "Full time — proofs landing",
    copy: "The match has ended. Settlement can move only after validation, and TxLINE's verification window often opens hours after full time. The receipts will appear here as they land.",
  },
  receipts: {
    label: "Receipts on-chain",
    copy: "Both markets settled by proof, in one transaction each. Verify either receipt yourself — that is the entire point.",
  },
} as const;

function fmtUtc(ms: number) {
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function MarketCard({
  market,
  role,
  blurb,
}: {
  market: Market | undefined;
  role: string;
  blurb: string;
}) {
  const info = oracleInfoFor(market?.oracle);
  const odds = market ? impliedProbability(market) : null;
  const status = market?.status ?? "open";

  return (
    <div className={`keystone-market-card keystone-market-card--${status}`}>
      <div className="keystone-market-card-head">
        <p className="eyebrow">{role}</p>
        <span className={`market-status-badge market-status-badge--${status}`}>
          {status.replace("_", " ")}
        </span>
      </div>
      <h3>{market ? formatMarketQuestion(market.predicate) : "Total goals over — market loading"}</h3>
      <p className="keystone-market-card-oracle">
        <strong>{info.name}</strong> · {blurb}
      </p>
      {market && odds && (
        <div className="keystone-market-card-odds">
          <span>YES {Math.round(odds.yes * 100)}%</span>
          <span>NO {Math.round(odds.no * 100)}%</span>
          <span>pool {(market.yesPool + market.noPool) / 1e9} SOL</span>
        </div>
      )}
      {market ? (
        <Link className="keystone-market-card-cta" href={`/markets/${market.id}`}>
          {status === "open" ? "Open the slip" : "View proof panel"} →
        </Link>
      ) : (
        <span className="keystone-market-card-cta keystone-market-card-cta--dead">
          market not yet on-chain
        </span>
      )}
    </div>
  );
}

function ReceiptRow({ label, market }: { label: string; market: Market | undefined }) {
  const status = market?.status;
  const line =
    status === "settled"
      ? `${market?.outcome?.toUpperCase() ?? "?"} — settlement receipt available`
      : status === "awaiting_settlement"
      ? "Settling — waiting on the validator's proof"
      : status === "void"
      ? "Voided — full refunds"
      : "Open — receipt appears after proof-gated settlement";
  return (
    <div className="keystone-receipt-row">
      <span>{label}</span>
      <span>{line}</span>
      {market && status === "settled" ? (
        <Link href={`/markets/${market.id}#proof`}>Verify ↗</Link>
      ) : (
        <span className="keystone-receipt-row--pending">pending</span>
      )}
    </div>
  );
}

export default function KeystonePage() {
  useMarkets();
  const markets = useStoppageStore((s) => s.markets);
  const { fixtures } = useFixtures();

  const ids = useMemo(() => keystoneMarketIds(), []);
  const txlineMarket = markets[ids.txline];
  const attestMarket = markets[ids.attest];

  // Live scores — TxLINE plane (fixture poll) and attest plane (tsdb event poll).
  const txlineFixture = useMemo(
    () => fixtures.find((f) => String(f.matchId) === ids.matchIds.txline) ?? null,
    [fixtures, ids]
  );
  const txlineScore = useFixtureScore(txlineFixture?.FixtureId ?? null);
  const attestEvent = useAttestEvent(ids.matchIds.attest);

  const times = keystoneTimes();
  const now = Date.now();
  const bothSettled = txlineMarket?.status === "settled" && attestMarket?.status === "settled";
  const phase = keystonePhase(now, bothSettled);
  const phaseCopy = PHASE_COPY[phase];
  const score = attestEvent?.snapshot ?? txlineScore ?? null;

  // Live countdown in the hero — to betting-open before it flips, then to
  // kickoff while slips are live. After kickoff the scoreline takes over.
  const countdownTarget =
    phase === "countdown" ? new Date(times.bettingOpensMs)
    : phase === "betting_open" ? new Date(times.kickoffMs)
    : null;
  const countdown = useCountdown(countdownTarget);
  const countdownVerb =
    phase === "countdown" ? "Betting opens in" : "Kickoff in";

  const timeline = [
    { label: "Betting opens", ts: times.bettingOpensMs },
    { label: "Kickoff", ts: times.kickoffMs },
    { label: "Full time (est.)", ts: times.estFullTimeMs },
    { label: "Receipts land by", ts: times.txlineReceiptByMs },
  ];

  return (
    <main className="app-shell">
      <div className="keystone-page">
        <MatchPulse
          live={phase === "in_play"}
          signalVersion={0}
          lastSignalType={null}
          className="match-pulse match-pulse--keystone"
        />

        {/* ── Hero ── */}
        <ElectricBorder variant={phase === "in_play" ? "blue" : "lime"} speed={phase === "in_play" ? 1.5 : 0.8} displacement={24} active>
          <div className="keystone-hero">
            <p className="eyebrow">The keystone · {KEYSTONE.league}</p>
            <h1>
              {KEYSTONE.homeTeam} v {KEYSTONE.awayTeam}
            </h1>
            <p className="keystone-hero-status">{phaseCopy.label}</p>
            <p className="keystone-hero-score" aria-live="polite">
              {score
                ? `${score.score.home} — ${score.score.away}`
                : countdownTarget
                ? `${countdownVerb} ${countdown || "…"}`
                : phase === "in_play"
                ? "Awaiting score feed"
                : "Awaiting receipts"}
            </p>
            <p className="keystone-lede">{phaseCopy.copy}</p>
          </div>
        </ElectricBorder>

        {/* ── The story — one line, not an essay ── */}
        <section className="keystone-story" aria-label="Why this match matters">
          <h2>One match. Two truth paths.</h2>
          <p>
            Same kickoff, two markets, two different proofs — each one gates
            its payout inside the settlement transaction. No proof, no money
            moves. The only difference is who vouches for the score.
          </p>
          <div className="keystone-story-contrast" aria-hidden="true">
            <span>TxLINE Merkle proof · third-party data</span>
            <span className="keystone-story-contrast-vs">vs</span>
            <span>Operator signature · honestly attested</span>
          </div>
        </section>

        {/* ── Countdown timeline ── */}
        <section className="keystone-timeline" aria-label="Campaign timeline">
          {timeline.map((step, i) => {
            const past = now > step.ts;
            const current = !past && (i === 0 || now > timeline[i - 1].ts);
            return (
              <div key={step.label} className={`keystone-timeline-step${past ? " keystone-timeline-step--past" : ""}${current ? " keystone-timeline-step--current" : ""}`}>
                <i aria-hidden="true">{past ? "✓" : ""}</i>
                <strong>{step.label}</strong>
                <small>{fmtUtc(step.ts)}</small>
              </div>
            );
          })}
        </section>

        {/* ── The two markets ── */}
        <section className="keystone-markets" aria-label="The two markets">
          <MarketCard
            market={txlineMarket}
            role="Path one · third-party data"
            blurb="Merkle proof from the vendor fixture network"
          />
          <div className="keystone-markets-vs" aria-hidden="true">vs</div>
          <MarketCard
            market={attestMarket}
            role="Path two · operator attestation"
            blurb="ed25519-signed observation — not network-verified, and we say so"
          />
        </section>

        {/* ── Lead capture ── */}
        <section className="keystone-notify-section" id="notify">
          <NotifyForm />
        </section>

        {/* ── Receipts — fills in on Sunday ── */}
        <section className="keystone-receipts" aria-label="Settlement receipts">
          <div className="keystone-receipts-head">
            <p className="eyebrow">Receipts</p>
            <h2>Settled by proof, publicly verifiable.</h2>
          </div>
          <p className="keystone-receipts-note">
            TxLINE&apos;s verification window often opens hours after full time.
            Receipts land as the proofs do — nothing here is promised faster
            than it&apos;s provable.
          </p>
          <ReceiptRow label="TxLINE Merkle path" market={txlineMarket} />
          <ReceiptRow label="Operator attestation path" market={attestMarket} />
        </section>

        <footer className="keystone-foot">
          <p>
            Predicates public: {KEYSTONE_TXLINE_PREDICATE.matchId} (goals over{" "}
            {KEYSTONE_TXLINE_PREDICATE.params.threshold}) ·{" "}
            {KEYSTONE_ATTEST_PREDICATE.matchId} (goals over{" "}
            {KEYSTONE_ATTEST_PREDICATE.params.threshold}) —{" "}
            <Link href="/operators">how validators integrate →</Link>
          </p>
          <p>Devnet SOL only. Set limits — the session cap is yours to choose.</p>
        </footer>
      </div>
    </main>
  );
}
