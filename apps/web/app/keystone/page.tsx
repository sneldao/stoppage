"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import { useMarkets } from "@/lib/markets/useMarkets";
import { useStoppageStore } from "@/store";
import { oracleInfoFor } from "@/lib/oracle";
import { formatMarketQuestion } from "@/lib/format";
import { useCountdown } from "@/lib/time/useCountdown";
import {
  keystoneMarketIds,
  KEYSTONE,
  KEYSTONE_OUTCOME,
  KEYSTONE_TXLINE_PREDICATE,
  KEYSTONE_ATTEST_PREDICATE,
  NEXT_KEYSTONE,
  nextKeystonePhase,
  nextKeystoneTimes,
} from "@/lib/campaign/keystone";
import { MatchPulse } from "@/components/MatchPulse";
import { ElectricBorder } from "@/components/ElectricBorder";

/**
 * /keystone — the proof story + the next milestone.
 *  Chapter 1: the Aug 15 keystone settled by proof (receipts now real).
 *  Chapter 2: the next keystone — Arsenal v Coventry, the first staked
 *             settle. All facts come from lib/campaign/keystone.ts.
 */

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
      ? "Settling — waiting on the validator’s proof"
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
  const ids = useMemo(() => keystoneMarketIds(), []);
  const txlineMarket = markets[ids.txline];
  const attestMarket = markets[ids.attest];

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ntimes = nextKeystoneTimes();
  const nextPhase = nextKeystonePhase(now, false);
  const countdownTarget =
    nextPhase === "countdown" ? new Date(ntimes.bettingOpensMs)
    : nextPhase === "betting_open" ? new Date(ntimes.kickoffMs)
    : null;
  const countdown = useCountdown(countdownTarget);
  const countdownVerb = nextPhase === "countdown" ? "Betting opens in" : "Kickoff in";

  const nextStatus =
    nextPhase === "countdown"
      ? `Betting opens Sat ${fmtUtc(ntimes.bettingOpensMs)}`
      : nextPhase === "betting_open"
      ? `Betting is open · kickoff ${fmtUtc(ntimes.kickoffMs)}`
      : "Full time — proofs landing";

  return (
    <main className="app-shell">
      <div className="keystone-page">
        <MatchPulse live={false} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--keystone" />

        {/* Chapter 1 — the proof held */}
        <ElectricBorder variant="lime" speed={0.8} displacement={24} active>
          <div className="keystone-hero">
            <p className="eyebrow">The keystone · Chapter 1 — proof achieved</p>
            <h1>The proof is the authority. It held.</h1>
            <p className="keystone-hero-status">{KEYSTONE.homeTeam} v {KEYSTONE.awayTeam} · settled by TxLINE proof</p>
            <p className="keystone-hero-score">Outcome {KEYSTONE_OUTCOME.txline.outcome} · {KEYSTONE_OUTCOME.txline.verifications} verification · one tx</p>
            <p className="keystone-lede">{KEYSTONE_OUTCOME.txline.note}</p>
          </div>
        </ElectricBorder>

        {/* Chapter 1 — the receipts */}
        <section className="keystone-receipts" aria-label="Aug 15 settlement receipts">
          <div className="keystone-receipts-head">
            <p className="eyebrow">Chapter 1 · on-chain proof</p>
            <h2>Settled by proof, publicly verifiable.</h2>
          </div>
          <p className="keystone-receipts-note">
            {KEYSTONE_OUTCOME.txline.note} The attested path missed its
            observation window, so it was voided (full refund) and its bond
            reclaimed — automatically.
          </p>
          <ReceiptRow label="TxLINE Merkle path" market={txlineMarket} />
          <div className="keystone-receipt-row">
            <span>Operator attestation path</span>
            <span>Voided — full refunds · bond reclaimed by housekeeper</span>
            <span className="keystone-receipt-row--pending">voided</span>
          </div>
        </section>

        {/* honest caveat */}
        <section className="keystone-story" aria-label="The honest caveat">
          <h2>Now the same proof — with a real stake.</h2>
          <p>{KEYSTONE_OUTCOME.caveat}</p>
        </section>

        {/* Chapter 2 — the next keystone */}
        <ElectricBorder variant="lime" speed={0.8} displacement={24} active>
          <div className="keystone-hero">
            <p className="eyebrow">Chapter 2 · next keystone — the first staked settle · {NEXT_KEYSTONE.league}</p>
            <h1>{NEXT_KEYSTONE.homeTeam} v {NEXT_KEYSTONE.awayTeam}</h1>
            <p className="keystone-hero-status">{nextStatus}</p>
            <p className="keystone-hero-score" aria-live="polite">
              {countdownTarget ? `${countdownVerb} ${countdown || "…"}` : "Receipts appearing…"}
            </p>
            <p className="keystone-lede">
              One fixture, one TxLINE proof path, your stake on the line. When the
              match settles, the proof gates the payout in the same transaction —
              no admin key moves a lamport. Total goals over 3.
            </p>
            <Link className="cal-cta-link op-cta-link" href="/markets">Place your stake on match day ↗</Link>
          </div>
        </ElectricBorder>

        {/* Operational trust — reliability is the product */}
        <section className="keystone-ops" aria-label="How the system stays honest">
          <p className="eyebrow">Kept honest, and kept running</p>
          <ul className="keystone-ops-list">
            <li><strong>Self-healing keeper</strong> — a 24/7 housekeeper settles, voids, and reclaims bonds automatically.</li>
            <li><strong>Credential health guard</strong> — the data subscription is probed every 6h; a lapse alerts instead of silently 401ing.</li>
            <li><strong>No admin key</strong> — fund release is gated on the on-chain proof, always.</li>
          </ul>
        </section>

        <section className="keystone-markets" aria-label="The Aug 15 proof artifacts">
          <MarketCard market={txlineMarket} role="Path one · settled by TxLINE proof" blurb="third-party Merkle data" />
          <div className="keystone-markets-vs" aria-hidden="true">vs</div>
          <MarketCard market={attestMarket} role="Path two · voided, honest" blurb="signed observation — window expired" />
        </section>

        <footer className="keystone-foot">
          <p>
            Predicates public: {KEYSTONE_TXLINE_PREDICATE.matchId} (goals over {String(KEYSTONE_TXLINE_PREDICATE.params.threshold)}) ·{" "}
            {KEYSTONE_ATTEST_PREDICATE.matchId} (goals over {String(KEYSTONE_ATTEST_PREDICATE.params.threshold)}) —{" "}
            <Link href="/operators">how validators integrate →</Link>
          </p>
          <p>Devnet SOL only. Set limits — the session cap is yours to choose.</p>
        </footer>
      </div>
    </main>
  );
}
