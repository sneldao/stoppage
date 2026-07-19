"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair } from "@solana/web3.js";
import { getMarket, impliedProbability, type Market, type Side } from "@stoppage/sdk";
import { useMarketActions } from "@/lib/markets/useMarketActions";
import type { ActionResult } from "@/lib/markets/useMarketActions";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useHeliusMonitor } from "@/lib/helius/useHeliusMonitor";
import { MatchkeeperStatus } from "@/components/MatchkeeperStatus";
import { ProofPath } from "@/components/ProofPath";
import { MarketWindow } from "@/components/MarketWindow";
import { SettlementMoment } from "@/components/SettlementMoment";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { ShareBar } from "@/components/ShareBar";
import { ProofPanel } from "@/components/ProofPanel";
import { ElectricBorder } from "@/components/ElectricBorder";
import { StoppageClock } from "@/components/StoppageClock";
import { formatSol as SOL, LAMPORTS_PER_SOL, formatMarketQuestion, formatSigningSpeed, formatConfirmationSpeed, formatSessionCountdown } from "@/lib/format";
import { OddsNumber } from "@/components/OddsNumber";
import { OddsSparkline } from "@/components/OddsSparkline";
import { MarketMatchContext } from "@/components/MarketMatchContext";
import { CallCard } from "@/components/CallCard";
import { ResolutionCard } from "@/components/ResolutionCard";
import { OdometerPool } from "@/components/OdometerPool";
import { MatchPulse } from "@/components/MatchPulse";

const stakePresets = ["0.01", "0.05", "0.10"];
const LAST_STAKE_KEY = "stoppage:last_stake";

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
  const { state, getSessionSigner, delegate, pause, resume, revoke } = useSessionKey();
  const { joinViaWallet, joinViaSessionKey, claim } = useMarketActions();
  useMyPositions();
  useHeliusMonitor();
  const feedState = useStoppageStore((s) => s.feedState);

  const storeMarket = useStoppageStore((s) => s.markets[marketAddr]);
  const recordActivity = useStoppageStore((s) => s.recordActivity);
  const setLastSigningMs = useStoppageStore((s) => s.setLastSigningMs);
  const myPosition = useStoppageStore((s) =>
    publicKey ? s.positions[`${marketAddr}:${publicKey.toBase58()}`] : undefined
  );
  const hasAnyHistory = useStoppageStore((s) => s.history.length > 0);

  const [liveMarket, setLiveMarket] = useState<Market | null>(storeMarket ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountSol, setAmountSol] = useState(() => {
    if (typeof window === "undefined") return "0.05";
    return localStorage.getItem(LAST_STAKE_KEY) ?? "0.05";
  });
  const [wantsOneTap, setWantsOneTap] = useState(true);
  const [justOnboarded, setJustOnboarded] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const initialSide = searchParams.get("side");
  const [selectedSide, setSelectedSide] = useState<Side | null>(
    initialSide === "yes" || initialSide === "no" ? initialSide : null
  );

  const initialStake = searchParams.get("stake");
  useEffect(() => {
    if (initialStake && stakePresets.includes(initialStake)) setAmountSol(initialStake);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist last stake across markets
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LAST_STAKE_KEY, amountSol);
  }, [amountSol]);

  // Surface session expiry instead of silently flipping to wallet approval
  useEffect(() => {
    if (state.keypair && state.expiresAt && state.expiresAt <= Date.now() && !state.paused) {
      setSessionNotice("One-tap session expired. Bets will use wallet approval until you re-enable.");
    } else if (state.paused) {
      setSessionNotice(null);
    } else {
      setSessionNotice(null);
    }
  }, [state.keypair, state.expiresAt, state.paused]);

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
        // First one-tap bet celebration — one time only
        if (viaSession && !hasAnyHistory && !justOnboarded) setJustOnboarded(true);
      }
      try { setLiveMarket(await getMarket(connection, new PublicKey(marketAddr))); } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const joinWithSigner = useCallback(async (signer: Keypair, side: Side, lamports: number) => {
    return joinViaSessionKey(signer, publicKey!, { market: new PublicKey(marketAddr), side, amountLamports: lamports });
  }, [joinViaSessionKey, publicKey, marketAddr]);

  const onJoin = () => {
    if (!selectedSide) { setError("Choose YES or NO first"); return; }
    if (!publicKey) { setError("Connect your wallet first"); return; }
    if (amountLamports <= 0) { setError("Enter a stake amount"); return; }

    // Already delegated and session valid → straight to one-tap
    const signer = getSessionSigner();
    setSubmittedWithSession(Boolean(signer));
    setReceipt(null);
    setLockedCall(null);
    if (signer) {
      void run(`join-${selectedSide}-session`, () => joinWithSigner(signer, selectedSide, amountLamports), true);
      return;
    }

    // Wallet path — optionally bundle delegation so the NEXT bet is one-tap.
    // This collapses onboarding from 3 popups to 2 (connect, this one).
    if (wantsOneTap && !state.paused && !state.delegated) {
      void run(`join-${selectedSide}-delegate`, async () => {
        await delegate();
        // Read the freshly-created keypair from storage (state hasn't flushed yet)
        const stored = localStorage.getItem("stoppage_session_key");
        if (!stored) throw new Error("Delegation succeeded but no session key was stored");
        const restored = JSON.parse(stored) as { secret: number[] };
        const fresh = Keypair.fromSecretKey(Uint8Array.from(restored.secret));
        return joinWithSigner(fresh, selectedSide, amountLamports);
      }, true);
      return;
    }

    void run(`join-${selectedSide}-wallet`, () =>
      joinViaWallet({ market: new PublicKey(marketAddr), side: selectedSide, amountLamports }));
  };

  const onPauseSession = () => {
    pause();
    setSessionNotice(null);
  };

  const onResumeSession = () => {
    setBusy("resume");
    setError(null);
    void resume()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null));
  };

  // Self-exclude path (rule 9): on-chain revoke. Destructive, irreversible
  // without a fresh delegation, but must stay prominent in the UI.
  const onEndSession = () => {
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
        <span className={`market-feed market-feed--${feedState}`}>
          <i className={feedState === "connected" ? "live-dot" : feedState === "polling" ? "schedule-dot" : "offline-dot"} />
          {feedState === "connected" ? "Live on-chain feed" : feedState === "polling" ? "Polling for updates" : "Feed offline"}
        </span>
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
                  {state.restoring
                    ? "… Checking one-tap"
                    : state.delegated
                    ? "⚡ One-tap ready"
                    : state.paused
                    ? "⏸ One-tap paused"
                    : "🔐 Wallet approval"}
                </span>
                {state.delegated && state.expiresAt && (
                  <span className="session-expiry-inline">
                    expires {formatSessionCountdown(state.expiresAt)}
                  </span>
                )}
                {state.delegated && (
                  <div className="slip-session-actions">
                    <button type="button" className="session-revoke" onClick={onPauseSession} disabled={busy !== null}
                      title="Temporarily drop the local key. No popup, no on-chain revoke — resume later with one signature.">
                      Pause one-tap
                    </button>
                    <button type="button" className="session-revoke session-revoke--destructive" onClick={onEndSession}
                      disabled={busy !== null}
                      title="Revoke the grant on-chain and refund rent. Irreversible without a fresh delegation.">
                      {busy === "revoke" ? "Ending…" : "End session"}
                    </button>
                  </div>
                )}
                {state.paused && (
                  <button type="button" className="session-revoke" onClick={onResumeSession} disabled={busy !== null}>
                    {busy === "resume" ? "Resuming…" : "Resume one-tap"}
                  </button>
                )}
              </div>

              {sessionNotice && <p className="slip-notice">{sessionNotice}</p>}

              {/* Step 1: Pick an outcome */}
              <div className="slip-step-label">
                <span className="slip-step-num">1</span>
                <span className="slip-step-text">Pick an outcome</span>
              </div>
              <div className="side-choice">
                <button
                  type="button"
                  className={`side-option side-yes ${selectedSide === "yes" ? "selected" : ""}`}
                  onClick={() => { setSelectedSide("yes"); setError(null); }}
                >
                  <span>YES · {odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x` : "—"}</span>
                  <strong><OddsNumber value={odds.yes} /></strong>
                  <small>{odds.yes > 0 ? `pays ${(1 / odds.yes).toFixed(2)} SOL per 1 SOL` : "Opening"}</small>
                </button>
                <button
                  type="button"
                  className={`side-option side-no ${selectedSide === "no" ? "selected" : ""}`}
                  onClick={() => { setSelectedSide("no"); setError(null); }}
                >
                  <span>NO · {odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x` : "—"}</span>
                  <strong><OddsNumber value={odds.no} /></strong>
                  <small>{odds.no > 0 ? `pays ${(1 / odds.no).toFixed(2)} SOL per 1 SOL` : "Opening"}</small>
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

              {/* One-tap opt-in on the wallet path — bundles delegation with
                  this bet so the next one is popup-free. Two popups total
                  (connect, this one) instead of three. */}
              {!state.delegated && !state.paused && publicKey && (
                <label className="slip-onetap-optin">
                  <input
                    type="checkbox"
                    checked={wantsOneTap}
                    onChange={(e) => setWantsOneTap(e.target.checked)}
                  />
                  <span>
                    <strong>Enable one-tap betting</strong> — this bet signs once in your
                    wallet; every bet after is instant, no popup. Session is capped and expires in 6h.
                  </span>
                </label>
              )}

              {/* Inline error — where the click happened, not page bottom */}
              {error && (
                <p className="slip-error" role="alert">
                  {error}
                  <button type="button" className="slip-error-retry" onClick={onJoin} disabled={busy !== null}>
                    Retry
                  </button>
                </p>
              )}

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

              {/* First one-tap celebration */}
              {justOnboarded && receipt?.viaSession && (
                <p className="slip-celebration">⚡ One-tap is on. This bet signed in {formatSigningSpeed(receipt.signingMs ?? 0)} — no popup.</p>
              )}

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

      {/* ── Settlement moment — the climax as an event ── */}
      <SettlementMoment market={market} myPosition={myPosition ?? undefined} />

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
            <div className="claim-block">
              <button type="button" className="claim-action" disabled={busy !== null}
                onClick={() => void run("claim", () => claim(new PublicKey(marketAddr)))}>
                {busy === "claim" ? "Claiming…" : "Claim payout"}
              </button>
              <span className="claim-note">Payouts require one wallet signature (owner-signed on-chain).</span>
              {error && busy === null && (
                <p className="slip-error" role="alert">
                  {error}
                  <button type="button" className="slip-error-retry"
                    onClick={() => void run("claim", () => claim(new PublicKey(marketAddr)))}>
                    Retry
                  </button>
                </p>
              )}
            </div>
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
