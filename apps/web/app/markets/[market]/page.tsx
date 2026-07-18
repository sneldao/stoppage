"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getMarket, impliedProbability, PREDICATE_LABEL, type Market, type Side } from "@stoppage/sdk";
import { useMarketActions } from "@/lib/markets/useMarketActions";
import type { ActionResult } from "@/lib/markets/useMarketActions";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useMyPositions } from "@/lib/markets/useMyPositions";
import { useStoppageStore } from "@/store";
import { ShareBar } from "@/components/ShareBar";
import { ProofPanel } from "@/components/ProofPanel";
import { formatSol as SOL, LAMPORTS_PER_SOL } from "@/lib/format";

const stakePresets = ["0.01", "0.05", "0.10"];

interface ExecutionReceipt extends ActionResult {
  viaSession: boolean;
}

function marketQuestion(market: Market) {
  const params = market.predicate.params;
  const value = params.windowSeconds ?? params.threshold ?? "";
  return `${PREDICATE_LABEL[market.predicate.kind] ?? market.predicate.kind} ${value}${params.team ? ` for ${params.team}` : ""}`;
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
  const myPosition = useStoppageStore((s) => publicKey ? s.positions[`${marketAddr}:${publicKey.toBase58()}`] : undefined);
  const [liveMarket, setLiveMarket] = useState<Market | null>(storeMarket ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountSol, setAmountSol] = useState("0.05");
  const initialSide = searchParams.get("side");
  const [selectedSide, setSelectedSide] = useState<Side | null>(initialSide === "yes" || initialSide === "no" ? initialSide : null);
  const [submittedWithSession, setSubmittedWithSession] = useState(false);
  const [receipt, setReceipt] = useState<ExecutionReceipt | null>(null);

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
    return <main className="market-shell market-loading"><p>Loading market instrument…</p>{error && <p className="market-error">{error}</p>}<Link href="/markets">Back to market tape</Link></main>;
  }

  const canJoin = market.status === "open";
  const canClaim = (market.status === "settled" || market.status === "void") && myPosition && myPosition.amountLamports > 0;
  const isWinner = market.status === "settled" && myPosition && myPosition.side === market.outcome;
  const executionBusy = busy?.startsWith("join");
  const selectedOdds = selectedSide ? odds[selectedSide] : 0;

  return (
    <main className="market-shell">
      <header className="market-nav"><Link href="/markets">← Market tape</Link><span>Focused position</span><span className="market-feed"><i className="live-dot" /> TxLINE connected</span></header>
      <section className="market-hero">
        <div className="market-hero-meta"><span>Live · Match {market.predicate.matchId}</span><span>Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
        <h1>{marketQuestion(market)}</h1>
        <div className="market-context"><span>{SOL(market.yesPool + market.noPool)} pool</span><span>Fee {market.feeBps / 100}%</span><span className="status-pill active">{market.status.replace("_", " ")}</span></div>
      </section>

      {canJoin && <section className="bet-slip" aria-label="Bet slip">
        <div className="bet-slip-head"><div><p className="eyebrow">Make your call</p><h2>Choose a side.</h2></div><div className="slip-session"><span className={state.delegated ? "fast-badge active" : "fast-badge"}>{state.delegated ? "Fast on" : "Wallet sign"}</span>{state.delegated && <button type="button" onClick={onRevokeSession} disabled={busy !== null}>{busy === "revoke" ? "Revoking…" : "Revoke"}</button>}</div></div>
        {state.delegated && state.expiresAt && <p className="session-expiry">Session expires {new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Revoke any time.</p>}
        <div className="side-choice">
          <button type="button" className={`side-option side-yes ${selectedSide === "yes" ? "selected" : ""}`} onClick={() => setSelectedSide("yes")}><span>YES</span><strong>{Math.round(odds.yes * 100)}%</strong><small>{odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x projected` : "Opening"}</small></button>
          <button type="button" className={`side-option side-no ${selectedSide === "no" ? "selected" : ""}`} onClick={() => setSelectedSide("no")}><span>NO</span><strong>{Math.round(odds.no * 100)}%</strong><small>{odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x projected` : "Opening"}</small></button>
        </div>
        <div className="stake-row"><span>Stake</span><div className="stake-options">{stakePresets.map((amount) => <button type="button" className={amountSol === amount ? "selected" : ""} onClick={() => setAmountSol(amount)} key={amount}>{amount}</button>)}<label><input type="number" min="0.001" step="0.01" value={amountSol} onChange={(event) => setAmountSol(event.target.value)} aria-label="Custom stake in SOL" /> SOL</label></div></div>
        <div className="slip-summary"><span>{selectedSide ? `${selectedSide.toUpperCase()} at ${Math.round(selectedOdds * 100)}%` : "Choose an outcome"}</span><strong>{selectedSide && selectedOdds > 0 ? `${(parseFloat(amountSol || "0") / selectedOdds).toFixed(3)} SOL projected` : "—"}</strong></div>
        <button type="button" className={`place-action ${executionBusy ? "place-action-busy" : ""}`} disabled={busy !== null} onClick={onJoin}>{executionBusy ? (submittedWithSession ? "Signing locally…" : "Awaiting wallet…") : selectedSide ? `Place ${selectedSide.toUpperCase()} position` : "Choose YES or NO"}<span>→</span></button>
        <div className={`execution-receipt ${receipt ? "execution-receipt-confirmed" : ""}`}>
          <span className={receipt?.viaSession ? "execution-ready" : "execution-pending"}><i /> {receipt ? receipt.viaSession ? `Signed locally · ${Math.round(receipt.signingMs ?? 0)}ms` : `Wallet approval + sign · ${Math.round(receipt.signingMs ?? 0)}ms` : state.delegated ? "Signed locally · no popup" : "Wallet approval required"}</span>
          <span>{executionBusy ? "Submitting to Solana" : receipt ? `Confirmed · ${receipt.confirmedAt - receipt.submittedAt}ms` : "Timing appears after submission"}</span>
          <span>{receipt ? "Proof path awaiting resolution" : "TxLINE proof at resolution"}</span>
        </div>
      </section>}

      {canJoin && <ShareBar market={market} pageUrl={typeof window !== "undefined" ? `${window.location.origin}/markets/${marketAddr}` : `/markets/${marketAddr}`} />}

      {myPosition && <section className="position-panel"><div><p className="eyebrow">Your position</p><h2>{myPosition.side.toUpperCase()} · {SOL(myPosition.amountLamports)}</h2></div><span className={myPosition.openedViaSessionKey ? "fast-badge active" : "fast-badge"}>{myPosition.openedViaSessionKey ? "Local sign" : "Wallet sign"}</span>{market.status === "settled" && <p className={isWinner ? "position-win" : "position-loss"}>{isWinner ? "Position won. Claim your payout." : "This position did not resolve in your favour."}</p>}{market.status === "void" && <p className="position-loss">Market voided. Claim a full refund.</p>}{canClaim && <button type="button" className="claim-action" disabled={busy !== null} onClick={() => void run("claim", () => claim(new PublicKey(marketAddr)))}>{busy === "claim" ? "Claiming…" : "Claim payout"}</button>}</section>}

      <ProofPanel market={market} />
      {error && <p className="market-error">{error}</p>}
    </main>
  );
}
