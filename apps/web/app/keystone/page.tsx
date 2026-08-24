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
  NEXT_KEYSTONE_OUTCOME,
  nextKeystoneMarketId,
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

function TxLink({ sig, label }: { sig: string; label: string }) {
  return (
    <a href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
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
  const nextId = useMemo(() => nextKeystoneMarketId(), []);
  const nextMarket = markets[nextId];
  const nextSettled = nextMarket?.status === "settled";
  const nextPhase = nextKeystonePhase(now, nextSettled);
  const countdownTarget =
    nextPhase === "countdown" ? new Date(ntimes.bettingOpensMs)
    : nextPhase === "betting_open" ? new Date(ntimes.kickoffMs)
    : null;
  const countdown = useCountdown(countdownTarget);
  const countdownVerb = nextPhase === "countdown" ? "Betting opens in" : "Kickoff in";

  const nextStatus = nextSettled
    ? `Settled ${NEXT_KEYSTONE_OUTCOME.outcome} by TxLINE proof · winner paid, vault drained`
    : nextPhase === "countdown"
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
          {nextSettled ? (
            <>
              <h2>The stake is proven. Both chapters closed.</h2>
              <p>
                Chapter 1 proved the proof gates settlement; Chapter 2 proved it
                gates a real payout — two wallets, opposite sides, the winner
                paid through the proof-gated path, the vault drained to zero.
                The same loop now runs across the covered season.
              </p>
            </>
          ) : (
            <>
              <h2>Now the same proof — with a real stake.</h2>
              <p>{KEYSTONE_OUTCOME.caveat}</p>
            </>
          )}
        </section>

        {/* Chapter 2 — the next keystone */}
        <ElectricBorder variant="lime" speed={0.8} displacement={24} active>
          <div className="keystone-hero">
            <p className="eyebrow">
              {nextSettled
                ? `Chapter 2 · the first staked settle — achieved · ${NEXT_KEYSTONE.league}`
                : `Chapter 2 · next keystone — the first staked settle · ${NEXT_KEYSTONE.league}`}
            </p>
            <h1>{NEXT_KEYSTONE.homeTeam} v {NEXT_KEYSTONE.awayTeam}</h1>
            <p className="keystone-hero-status">{nextStatus}</p>
            <p className="keystone-hero-score" aria-live="polite">
              {nextSettled
                ? `Outcome ${NEXT_KEYSTONE_OUTCOME.outcome} · ${NEXT_KEYSTONE_OUTCOME.verifications} verification · vault drained to zero`
                : countdownTarget
                ? `${countdownVerb} ${countdown || "…"}`
                : "Receipts appearing…"}
            </p>
            <p className="keystone-lede">
              {nextSettled
                ? NEXT_KEYSTONE_OUTCOME.settleNote
                : "One fixture, one TxLINE proof path, your stake on the line. When the match settles, the proof gates the payout in the same transaction — no admin key moves a lamport. Total goals over 3."}
            </p>
            <Link className="cal-cta-link op-cta-link" href={`/markets/${nextId}`}>
              {nextSettled
                ? "View the proof panel ↗"
                : `Open the ${NEXT_KEYSTONE.homeTeam} v ${NEXT_KEYSTONE.awayTeam} slip ↗`}
            </Link>
          </div>
        </ElectricBorder>

        {/* Chapter 2 — the receipts (filled on settlement) */}
        {nextSettled && (
          <section className="keystone-receipts" aria-label="Aug 21 settlement receipts">
            <div className="keystone-receipts-head">
              <p className="eyebrow">Chapter 2 · on-chain proof · real stakes</p>
              <h2>Staked, settled by proof, paid out.</h2>
            </div>
            <p className="keystone-receipts-note">
              Two wallets staked {NEXT_KEYSTONE_OUTCOME.stakePerSideSol} SOL each on
              opposite sides. {NEXT_KEYSTONE_OUTCOME.winnerPayoutNote}{" "}
              {NEXT_KEYSTONE_OUTCOME.vaultNote}
            </p>
            <div className="keystone-receipt-row">
              <span>Settlement (TxLINE proof via CPI)</span>
              <span>{NEXT_KEYSTONE_OUTCOME.outcome} · {NEXT_KEYSTONE_OUTCOME.verifications} verification · {NEXT_KEYSTONE_OUTCOME.settlesAtIso}</span>
              <TxLink sig={NEXT_KEYSTONE_OUTCOME.settleTx} label="tx" />
            </div>
            <div className="keystone-receipt-row">
              <span>Winner claim (NO)</span>
              <span>Paid through the proof-gated path · fee skimmed to treasury</span>
              <TxLink sig={NEXT_KEYSTONE_OUTCOME.winnerClaimTx} label="tx" />
            </div>
            <div className="keystone-receipt-row">
              <span>Loser claim (YES)</span>
              <span>{NEXT_KEYSTONE_OUTCOME.loserClaimNote}</span>
              <TxLink sig={NEXT_KEYSTONE_OUTCOME.loserClaimTx} label="tx" />
            </div>
            <div className="keystone-receipt-row">
              <span>Vault</span>
              <span>{NEXT_KEYSTONE_OUTCOME.vaultNote}</span>
              <a href={`https://explorer.solana.com/address/${nextId}?cluster=devnet`} target="_blank" rel="noreferrer">account ↗</a>
            </div>
          </section>
        )}

        {/* Operational trust — reliability is the product */}
        <section className="keystone-ops" aria-label="How the system stays honest">
          <p className="eyebrow">Kept honest, and kept running</p>
          <ul className="keystone-ops-list">
            <li><strong>Self-healing keeper</strong> — a 24/7 housekeeper settles, voids, and reclaims bonds automatically.</li>
            <li><strong>Credential health guard</strong> — the data subscription is probed every 6h; a lapse alerts instead of silently 401ing.</li>
            <li><strong>No admin key</strong> — fund release is gated on the on-chain proof, always.</li>
          </ul>
        </section>

        {/* Guided flow — the first staked settle, in four steps */}
        <section className="keystone-ops" aria-label="Your first staked settle — in four steps">
          <p className="eyebrow">Your first staked settle · four steps</p>
          <ol className="keystone-ops-list">
            <li><strong>Delegate a session key</strong> — one wallet popup; afterwards bets sign with no popups.</li>
            <li><strong>Fund the session</strong> — the session holds devnet SOL for stakes + fees.</li>
            <li><strong>Place your stake</strong> — open the {NEXT_KEYSTONE.homeTeam} v {NEXT_KEYSTONE.awayTeam} slip, pick YES or NO.</li>
            <li><strong>Settle &amp; claim</strong> — after the match, the proof gates the payout in the same tx; you claim it.</li>
          </ol>
          <p>
            {nextSettled
              ? "M2 acceptance met Aug 21–24: two wallets on opposite sides, settled from a proof, winner claimed, vault drained to zero."
              : "M2 acceptance: two wallets on opposite sides, settled from a proof, vault drains to zero."}
          </p>
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
