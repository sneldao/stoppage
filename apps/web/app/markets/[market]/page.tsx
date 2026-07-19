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
import { formatSol as SOL, LAMPORTS_PER_SOL, formatMarketQuestion, formatSigningSpeed, formatConfirmationSpeed } from "@/lib/format";
import { OddsNumber } from "@/components/OddsNumber";
import { OddsSparkline } from "@/components/OddsSparkline";
import { MarketMatchContext } from "@/components/MarketMatchContext";
import { CallCard } from "@/components/CallCard";
import { ResolutionCard } from "@/components/ResolutionCard";
import { OdometerPool } from "@/components/OdometerPool";

const stakePresets = ["0.01", "0.05", "0.10"];

interface ExecutionReceipt extends ActionResult {
  viaSession: boolean;
}

interface LockedCall {
  side: Side;
  amountSol: string;
  probability: number;
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
  const myPosition = useStoppageStore((s) => publicKey ? s.positions[`${marketAddr}:${publicKey.toBase58()}`] : undefined);
  const [liveMarket, setLiveMarket] = useState<Market | null>(storeMarket ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountSol, setAmountSol] = useState("0.05");
  const initialSide = searchParams.get("side");
  const [selectedSide, setSelectedSide] = useState<Side | null>(initialSide === "yes" || initialSide === "no" ? initialSide : null);
  const [submittedWithSession, setSubmittedWithSession] = useState(false);
  const [receipt, setReceipt] = useState<ExecutionReceipt | null>(null);
  const [lockedCall, setLockedCall] = useState<LockedCall | null>(null);

  useEffect(() => {
    if (storeMarket) {
      setLiveMarket(storeMarket);
      return;
    }
    let cancelled = false;
    void getMarket(connection, new PublicKey(marketAddr))
      .then((market) => { if (!cancelled) setLiveMarket(market); })
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
        setLockedCall({
          side: selectedSide,
          amountSol,
          probability: Math.round(selectedOdds * 100),
        });
        recordActivity({
          id: `position-${result.signature}`,
          occurredAt: result.confirmedAt,
          kind: "position_submitted",
          label: `${selectedSide.toUpperCase()} position · ${SOL(amountLamports)} · ${viaSession ? "Fast Session" : "Wallet signed"}`,
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
    if (!selectedSide) {
      setError("Choose YES or NO first");
      return;
    }
    if (!publicKey) {
      setError("Connect your wallet first");
      return;
    }
    if (amountLamports <= 0) {
      setError("Enter a stake amount");
      return;
    }
    const signer = getSessionSigner();
    const usesSession = Boolean(signer && state.delegated);
    setSubmittedWithSession(usesSession);
    setReceipt(null);
    setLockedCall(null);
    if (signer && state.delegated) {
      void run(`join-${selectedSide}-session`, () => joinViaSessionKey(signer, publicKey, { market: new PublicKey(marketAddr), side: selectedSide, amountLamports }), true);
      return;
    }
    void run(`join-${selectedSide}-wallet`, () => joinViaWallet({ market: new PublicKey(marketAddr), side: selectedSide, amountLamports }));
  };

  const onRevokeSession = () => {
    setBusy("revoke");
    setError(null);
    void revoke()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null));
  };

  if (!market) {
    return <main className="market-shell market-loading"><p>Loading market…</p>{error && <p className="market-error">{error}</p>}<Link href="/markets">Back to markets</Link></main>;
  }

  const canJoin = market.status === "open";
  const canClaim = (market.status === "settled" || market.status === "void") && myPosition && myPosition.amountLamports > 0;
  const isWinner = market.status === "settled" && myPosition && myPosition.side === market.outcome;
  const executionBusy = busy?.startsWith("join");
  const selectedOdds = selectedSide ? odds[selectedSide] : 0;

  return (
    <main className="market-shell">
      <header className="market-nav"><Link href="/markets">← Markets</Link><span>Position</span><span className="market-feed"><i className="live-dot" /> TxLINE connected</span></header>
      <section className="market-hero">
        <div className="market-hero-meta"><span>Live · Match {market.predicate.matchId}</span><span>Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
        <h1>{formatMarketQuestion(market.predicate)}</h1>
        <div className="market-context"><OdometerPool lamports={market.yesPool + market.noPool} label="Pool" className="market-context-odometer" /><span>{market.feeBps / 100}% fee · no house · peer-funded</span><span className="status-pill active">{market.status.replace("_", " ")}</span></div>
      </section>

      <MarketMatchContext matchId={market.predicate.matchId} />
      <MarketWindow closesAt={market.closesAt} status={market.status} />

      {canJoin && <section className="bet-slip" aria-label="Bet slip">
        <div className="bet-slip-head"><div><p className="eyebrow">Place your bet</p><h2>Choose a side.</h2></div><div className="slip-session"><span className={state.delegated ? "fast-badge active" : "fast-badge"}>{state.delegated ? "Fast on" : "Wallet sign"}</span>{state.delegated && <button type="button" onClick={onRevokeSession} disabled={busy !== null}>{busy === "revoke" ? "Revoking…" : "Revoke"}</button>}</div></div>
        {state.delegated && state.expiresAt && <p className="session-expiry">Session expires {new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Revoke any time.</p>}
        <div className="side-choice">
          <button type="button" className={`side-option side-yes ${selectedSide === "yes" ? "selected" : ""}`} onClick={() => setSelectedSide("yes")}><span>YES</span><strong><OddsNumber value={odds.yes} /></strong><small>{odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x projected` : "Opening"}</small></button>
          <button type="button" className={`side-option side-no ${selectedSide === "no" ? "selected" : ""}`} onClick={() => setSelectedSide("no")}><span>NO</span><strong><OddsNumber value={odds.no} /></strong><small>{odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x projected` : "Opening"}</small></button>
        </div>
        <div className="bet-slip-odds-history"><OddsSparkline marketId={market.id} currentYes={odds.yes} width={200} height={28} /></div>
        <div className="stake-row"><span>Stake</span><div className="stake-options">{stakePresets.map((amount) => <button type="button" className={amountSol === amount ? "selected" : ""} onClick={() => setAmountSol(amount)} key={amount}>{amount}</button>)}<label><input type="number" min="0.001" step="0.01" value={amountSol} onChange={(event) => setAmountSol(event.target.value)} aria-label="Custom stake in SOL" /> SOL</label></div></div>
        <div className="slip-summary"><span>{selectedSide ? `${selectedSide.toUpperCase()} at ${Math.round(selectedOdds * 100)}%` : "Choose an outcome"}</span><strong>{selectedSide && selectedOdds > 0 ? `${(parseFloat(amountSol || "0") / selectedOdds).toFixed(3)} SOL estimated return` : "—"}</strong></div>
        <p className="stake-risk">At risk: {amountSol || "0"} SOL. You can lose your full stake. Estimated returns can move until your position confirms.</p>
        <button type="button" className={`place-action ${executionBusy ? "place-action-busy" : ""}`} disabled={busy !== null || !selectedSide} onClick={onJoin}>{executionBusy ? (submittedWithSession ? "Signing locally…" : "Awaiting wallet…") : selectedSide ? `Place ${selectedSide.toUpperCase()} bet` : "Choose YES or NO"}<span>→</span></button>
        {receipt?.viaSession ? (
          <div className="execution-hero">
            <div className="execution-hero-speed">
              <strong>{formatSigningSpeed(receipt.signingMs ?? 0)}</strong>
              <span>signed</span>
            </div>
            <p className="execution-hero-compare">A wallet popup takes 3–5 seconds. You just bet in <strong>{formatSigningSpeed(receipt.signingMs ?? 0)}</strong>.</p>
            <div className="execution-hero-meta">
              <span>Confirmed in {formatConfirmationSpeed(receipt.submittedAt, receipt.confirmedAt)}</span>
              <a href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`} target="_blank" rel="noreferrer">View tx ↗</a>
            </div>
          </div>
        ) : (
          <div className={`execution-receipt ${receipt ? "execution-receipt-confirmed" : ""}`}>
            <span className={receipt ? "execution-pending" : "execution-pending"}><i /> {receipt ? `Wallet sign · ${formatSigningSpeed(receipt.signingMs ?? 0)}` : state.delegated ? "Signed locally · no popup" : "Wallet approval required"}</span>
            <span>{executionBusy ? "Submitting to Solana" : receipt ? `Confirmed · ${formatConfirmationSpeed(receipt.submittedAt, receipt.confirmedAt)}` : "Timing appears after submission"}</span>
            <span>{receipt ? "Proof path awaiting resolution" : "TxLINE proof at resolution"}</span>
          </div>
        )}
      </section>}

      {canJoin && !receipt && <ShareBar market={market} pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`} />}

      {receipt && lockedCall && <CallCard
        market={market}
        side={lockedCall.side}
        amountSol={lockedCall.amountSol}
        probability={lockedCall.probability}
        signingMs={receipt.signingMs}
        pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`}
      />}

      <details className="market-trust-details">
        <summary>How this market settles</summary>
        <div><MatchkeeperStatus marketPhase={market.status} compact /><ProofPath status={market.status} /></div>
      </details>

      {myPosition && <section className="position-panel"><div><p className="eyebrow">Your bet</p><h2>{myPosition.side.toUpperCase()} · {SOL(myPosition.amountLamports)}</h2></div><span className={myPosition.openedViaSessionKey ? "fast-badge active" : "fast-badge"}>{myPosition.openedViaSessionKey ? "Local sign" : "Wallet sign"}</span>{market.status === "settled" && <p className={isWinner ? "position-win" : "position-loss"}>{isWinner ? "You won! Claim your payout." : "This bet did not resolve in your favour."}</p>}{market.status === "void" && <p className="position-loss">Market voided. Claim a full refund.</p>}<Link className="position-match-link" href="/match">Back to match <span>→</span></Link>{canClaim && <button type="button" className="claim-action" disabled={busy !== null} onClick={() => void run("claim", () => claim(new PublicKey(marketAddr)))}>{busy === "claim" ? "Claiming…" : "Claim payout"}</button>}</section>}

      {market.status === "settled" && myPosition && <ResolutionCard
        market={market}
        position={myPosition}
        isWinner={Boolean(isWinner)}
        pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`}
        signingMs={receipt?.signingMs}
      />}

      <div id="proof"><ProofPanel market={market} /></div>
      {error && <p className="market-error">{error}</p>}
    </main>
  );
}
