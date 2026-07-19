"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getMarket, impliedProbability, type Market, type Side } from "@stoppage/sdk";
import { useMarketActions } from "@/lib/markets/useMarketActions";
import type { ActionResult } from "@/lib/markets/useMarketActions";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ProofPath } from "@/components/ProofPath";
import { MarketWindow } from "@/components/MarketWindow";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { ShareBar } from "@/components/ShareBar";
import { ProofPanel } from "@/components/ProofPanel";
import { ElectricBorder } from "@/components/ElectricBorder";
import { StoppageClock } from "@/components/StoppageClock";
import { formatSol as SOL, LAMPORTS_PER_SOL, formatMarketQuestion, formatSigningSpeed, formatConfirmationSpeed } from "@/lib/format";
import { OddsNumber } from "@/components/OddsNumber";
import { OddsSparkline } from "@/components/OddsSparkline";
import { MarketMatchContext } from "@/components/MarketMatchContext";
import { CallCard } from "@/components/CallCard";
import { ResolutionCard } from "@/components/ResolutionCard";
import { OdometerPool } from "@/components/OdometerPool";
import { MatchPulse } from "@/components/MatchPulse";

const stakePresets = ["0.01", "0.05", "0.10"];

interface ExecutionReceipt extends ActionResult {
  viaSession: boolean;
}

interface LockedCall {
  side: Side;
  amountSol: string;
  probability: number;
}

// Border variant driven by market status
function borderVariant(status: Market["status"]): "lime" | "amber" | "blue" | "green" {
  if (status === "open") return "lime";
  if (status === "awaiting_settlement") return "amber";
  if (status === "settled") return "blue";
  return "green";
}

export default function MarketDetailPage() {
  const params = useParams<{ market: string }>();
  const searchParams = useSearchParams();
  const marketAddr = params.market;
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { state, getSessionSigner, revoke } = useSessionKey();
  const { joinViaWallet, joinViaSessionKey, claim } = useMarketActions();
  useMyPositions();

  const storeMarket = useStoppageStore((s) => s.markets[marketAddr]);
  const recordActivity = useStoppageStore((s) => s.recordActivity);
  const setLastSigningMs = useStoppageStore((s) => s.setLastSigningMs);
  const myPosition = useStoppageStore((s) =>
    publicKey ? s.positions[`${marketAddr}:${publicKey.toBase58()}`] : undefined
  );

  const [liveMarket, setLiveMarket] = useState<Market | null>(storeMarket ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountSol, setAmountSol] = useState("0.05");

  const initialSide = searchParams.get("side");
  const [selectedSide, setSelectedSide] = useState<Side | null>(
    initialSide === "yes" || initialSide === "no" ? initialSide : null
  );

  const initialStake = searchParams.get("stake");
  useEffect(() => {
    if (initialStake && stakePresets.includes(initialStake)) setAmountSol(initialStake);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [submittedWithSession, setSubmittedWithSession] = useState(false);
  const [receipt, setReceipt] = useState<ExecutionReceipt | null>(null);
  const [lockedCall, setLockedCall] = useState<LockedCall | null>(null);

  useEffect(() => {
    if (storeMarket) { setLiveMarket(storeMarket); return; }
    let cancelled = false;
    void getMarket(connection, new PublicKey(marketAddr))
      .then((m) => { if (!cancelled) setLiveMarket(m); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [connection, marketAddr, storeMarket]);

  useEffect(() => {
    if (initialSide === "yes" || initialSide === "no") setSelectedSide(initialSide);
  }, [initialSide]);

  const market = liveMarket ?? storeMarket ?? null;
  const odds = market ? impliedProbability(market) : { yes: 0.5, no: 0.5 };
  const amountLamports = Math.round(parseFloat(amountSol || "0") * LAMPORTS_PER_SOL);

  const run = async (label: string, fn: () => Promise<ActionResult>, viaSession = false) => {
    setBusy(label);
    setError(null);
    try {
      const result = await fn();
      setReceipt({ ...result, viaSession });
      if (result.signingMs !== undefined) setLastSigningMs(result.signingMs);
      if (label.startsWith("join-") && market && selectedSide) {
        setLockedCall({ side: selectedSide, amountSol, probability: Math.round(selectedOdds * 100) });
        recordActivity({
          id: `position-${result.signature}`,
          occurredAt: result.confirmedAt,
          kind: "position_submitted",
          label: `${selectedSide.toUpperCase()} · ${SOL(amountLamports)} · ${viaSession ? "One-tap" : "Wallet signed"}`,
          matchId: market.predicate.matchId,
          marketId: market.id,
          signature: result.signature,
          source: "wallet",
        });
      }
      try { setLiveMarket(await getMarket(connection, new PublicKey(marketAddr))); } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const onJoin = () => {
    if (!selectedSide) { setError("Choose YES or NO first"); return; }
    if (!publicKey) { setError("Connect your wallet first"); return; }
    if (amountLamports <= 0) { setError("Enter a stake amount"); return; }
    const signer = getSessionSigner();
    const usesSession = Boolean(signer && state.delegated);
    setSubmittedWithSession(usesSession);
    setReceipt(null);
    setLockedCall(null);
    if (signer && state.delegated) {
      void run(`join-${selectedSide}-session`, () =>
        joinViaSessionKey(signer, publicKey, { market: new PublicKey(marketAddr), side: selectedSide, amountLamports }), true);
      return;
    }
    void run(`join-${selectedSide}-wallet`, () =>
      joinViaWallet({ market: new PublicKey(marketAddr), side: selectedSide, amountLamports }));
  };

  const onRevokeSession = () => {
    setBusy("revoke");
    setError(null);
    void revoke()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null));
  };

  if (!market) {
    return (
      <main className="market-shell market-loading">
        <p>Loading market…</p>
        {error && <p className="market-error">{error}</p>}
        <Link href="/markets">Back to markets</Link>
      </main>
    );
  }

  const canJoin = market.status === "open";
  const canClaim = (market.status === "settled" || market.status === "void") && myPosition && myPosition.amountLamports > 0;
  const isWinner = market.status === "settled" && myPosition && myPosition.side === market.outcome;
  const executionBusy = busy?.startsWith("join");
  const selectedOdds = selectedSide ? odds[selectedSide] : 0;
  const variant = borderVariant(market.status);

  return (
    <main className="market-shell">
      <MatchPulse live={market.status === "open"} signalVersion={0} lastSignalType={null} className="match-pulse match-pulse--detail" />

      {/* ── Nav ── */}
      <header className="market-nav">
        <Link href="/markets">← Markets</Link>
        <span>Position</span>
        <span className="market-feed"><i className="live-dot" /> Live data connected</span>
      </header>

      {/* ── Hero instrument — ElectricBorder wraps the whole hero + slip ── */}
      <ElectricBorder variant={variant} speed={market.status === "open" ? 1.2 : 0.6} displacement={24} active>
        <div className="market-instrument">

          {/* Background clock — same motif as homepage */}
          <div className="market-instrument-clock" aria-hidden="true">
            <StoppageClock size={420} globalPointer={false} />
          </div>

          {/* Hero: score context + question */}
          <div className="market-instrument-hero">
            {/* Match context embedded at top of hero */}
            <MarketMatchContext matchId={market.predicate.matchId} />

            <div className="market-instrument-meta">
              <span className={`market-status-badge market-status-badge--${market.status}`}>
                {market.status === "open" && <i className="live-dot" style={{ width: 6, height: 6, marginRight: 6 }} />}
                {market.status.replace("_", " ")}
              </span>
              <MarketWindow closesAt={market.closesAt} status={market.status} />
            </div>

            <h1 className="market-instrument-title">{formatMarketQuestion(market.predicate)}</h1>

            {/* Pool counter — prominent, centred */}
            <div className="market-instrument-pool">
              <OdometerPool lamports={market.yesPool + market.noPool} label="Live pool" />
              <span className="market-instrument-pool-meta">{market.feeBps / 100}% fee · no house · peer-funded</span>
            </div>
          </div>

          {/* ── Bet slip ── */}
          {canJoin && (
            <section className="market-bet-slip" aria-label="Bet slip">
              {/* Session badge */}
              <div className="slip-session-row">
                <span className={state.delegated ? "fast-badge active" : "fast-badge"}>
                  {state.delegated ? "⚡ One-tap ready" : "🔐 Wallet approval"}
                </span>
                {state.delegated && (
                  <button type="button" className="session-revoke" onClick={onRevokeSession} disabled={busy !== null}>
                    {busy === "revoke" ? "Pausing…" : "Pause one-tap"}
                  </button>
                )}
              </div>

              {/* Step 1: Pick an outcome */}
              <div className="slip-step-label">
                <span className="slip-step-num">1</span>
                <span className="slip-step-text">Pick an outcome</span>
              </div>
              <div className="side-choice">
                <button
                  type="button"
                  className={`side-option side-yes ${selectedSide === "yes" ? "selected" : ""}`}
                  onClick={() => setSelectedSide("yes")}
                >
                  <span>YES · {odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x` : "—"}</span>
                  <strong><OddsNumber value={odds.yes} /></strong>
                  <small>{odds.yes > 0 ? `${Math.round(odds.yes * 100)}¢ per $1` : "Opening"}</small>
                </button>
                <button
                  type="button"
                  className={`side-option side-no ${selectedSide === "no" ? "selected" : ""}`}
                  onClick={() => setSelectedSide("no")}
                >
                  <span>NO · {odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x` : "—"}</span>
                  <strong><OddsNumber value={odds.no} /></strong>
                  <small>{odds.no > 0 ? `${Math.round(odds.no * 100)}¢ per $1` : "Opening"}</small>
                </button>
              </div>

              {/* Odds history sparkline */}
              <div className="slip-sparkline">
                <OddsSparkline marketId={market.id} currentYes={odds.yes} width={220} height={30} />
              </div>

              {/* Step 2: Choose your stake */}
              <div className="slip-step-label">
                <span className="slip-step-num">2</span>
                <span className="slip-step-text">Choose your stake</span>
              </div>
              <div className="stake-row">
                <span>Stake</span>
                <div className="stake-options">
                  {stakePresets.map((amount) => (
                    <button
                      type="button"
                      className={amountSol === amount ? "selected" : ""}
                      onClick={() => setAmountSol(amount)}
                      key={amount}
                    >
                      {amount}
                    </button>
                  ))}
                  <label>
                    <input
                      type="number"
                      min="0.001"
                      step="0.01"
                      value={amountSol}
                      onChange={(e) => setAmountSol(e.target.value)}
                      aria-label="Custom stake in SOL"
                    /> SOL
                  </label>
                </div>
              </div>

              {/* Step 3: Confirm — risk summary + place button */}
              <div className="slip-step-label">
                <span className="slip-step-num">3</span>
                <span className="slip-step-text">Confirm your bet</span>
              </div>
              <div className="slip-summary">
                <span>
                  {selectedSide
                    ? `${selectedSide.toUpperCase()} · ${amountSol || "0"} SOL at risk`
                    : "Choose an outcome first"}
                </span>
                <strong>
                  {selectedSide && selectedOdds > 0
                    ? `${(parseFloat(amountSol || "0") / selectedOdds).toFixed(3)} SOL est. return`
                    : "—"}
                </strong>
              </div>

              {/* Place bet */}
              <button
                type="button"
                className={`place-action ${executionBusy ? "place-action-busy" : ""}`}
                disabled={busy !== null || !selectedSide}
                onClick={onJoin}
              >
                {executionBusy
                  ? (submittedWithSession ? "Signing locally…" : "Awaiting wallet…")
                  : selectedSide ? `Place ${selectedSide.toUpperCase()} bet` : "Choose YES or NO"}
                <span>→</span>
              </button>

              {/* Receipt */}
              {receipt?.viaSession ? (
                <div className="execution-hero">
                  <div className="execution-hero-speed">
                    <strong>{formatSigningSpeed(receipt.signingMs ?? 0)}</strong>
                    <span>signed</span>
                  </div>
                  <p className="execution-hero-compare">
                    Wallet popup: 3–5 s. You just bet in <strong>{formatSigningSpeed(receipt.signingMs ?? 0)}</strong>.
                  </p>
                  <div className="execution-hero-meta">
                    <span>Confirmed {formatConfirmationSpeed(receipt.submittedAt, receipt.confirmedAt)}</span>
                    <a href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`} target="_blank" rel="noreferrer">View tx ↗</a>
                  </div>
                </div>
              ) : (
                <div className={`execution-receipt ${receipt ? "execution-receipt-confirmed" : ""}`}>
                  <span className="execution-pending">
                    <i /> {receipt
                      ? `Wallet · ${formatSigningSpeed(receipt.signingMs ?? 0)}`
                      : state.delegated ? "One-tap · no popup" : "Wallet approval required"}
                  </span>
                  <span>
                    {executionBusy ? "Submitting…" : receipt
                      ? `Confirmed · ${formatConfirmationSpeed(receipt.submittedAt, receipt.confirmedAt)}`
                      : "Timing after submission"}
                  </span>
                  <span>{receipt ? "Result verified automatically" : "Result verified at resolution"}</span>
                </div>
              )}
            </section>
          )}

          {/* Share bar — trimmed to two actions */}
          {canJoin && !receipt && (
            <div className="market-share-strip">
              <ShareBar market={market} pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`} compact />
            </div>
          )}
        </div>
      </ElectricBorder>

      {/* ── Post-bet call card ── */}
      {receipt && lockedCall && (
        <CallCard
          market={market}
          side={lockedCall.side}
          amountSol={lockedCall.amountSol}
          probability={lockedCall.probability}
          signingMs={receipt.signingMs}
          pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`}
        />
      )}

      {/* ── Your position ── */}
      {myPosition && (
        <section className="position-panel">
          <div>
            <p className="eyebrow">Your bet</p>
            <h2>{myPosition.side.toUpperCase()} · {SOL(myPosition.amountLamports)}</h2>
          </div>
          <span className={myPosition.openedViaSessionKey ? "fast-badge active" : "fast-badge"}>
            {myPosition.openedViaSessionKey ? "Local sign" : "Wallet sign"}
          </span>
          {market.status === "settled" && (
            <p className={isWinner ? "position-win" : "position-loss"}>
              {isWinner ? "You won — claim your payout." : "This bet did not resolve in your favour."}
            </p>
          )}
          {market.status === "void" && <p className="position-loss">Market voided. Claim a full refund.</p>}
          <Link className="position-match-link" href="/match">Back to match <span>→</span></Link>
          {canClaim && (
            <button type="button" className="claim-action" disabled={busy !== null}
              onClick={() => void run("claim", () => claim(new PublicKey(marketAddr)))}>
              {busy === "claim" ? "Claiming…" : "Claim payout"}
            </button>
          )}
        </section>
      )}

      {/* ── Resolution card ── */}
      {market.status === "settled" && myPosition && (
        <ResolutionCard
          market={market}
          position={myPosition}
          isWinner={Boolean(isWinner)}
          pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`}
          signingMs={receipt?.signingMs}
        />
      )}

      {/* ── Settlement path — always visible, not behind a toggle ── */}
      <div className="market-settlement-path">
        <div className="market-settlement-path-inner">
          <MatchkeeperStatus marketPhase={market.status} compact />
          <ProofPath status={market.status} />
        </div>
      </div>

      {/* ── Proof panel ── */}
      <div id="proof"><ProofPanel market={market} /></div>

      {error && <p className="market-error">{error}</p>}
    </main>
  );
}
