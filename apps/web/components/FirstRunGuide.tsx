"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSessionKey } from "@/lib/session-key/useSessionKey";

interface FirstRunGuideProps {
  marketHref?: string;
  compact?: boolean;
}

export function FirstRunGuide({ marketHref = "/markets", compact = false }: FirstRunGuideProps) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { state, delegate, revoke } = useSessionKey();
  const [busy, setBusy] = useState<"delegate" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "delegate" | "revoke") => {
    setBusy(action);
    setError(null);
    try {
      await (action === "delegate" ? delegate() : revoke());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session action failed");
    } finally {
      setBusy(null);
    }
  };

  const step = state.delegated ? 3 : publicKey ? 2 : 1;
  const nextAction = state.delegated ? "Place your first bet" : publicKey ? "Enable Fast Session" : "Connect your wallet";

  return (
    <aside className={`onboarding-panel${compact ? " onboarding-panel-compact" : ""}`} id="fast-setup" aria-labelledby="fast-setup-title">
      <div className="onboarding-head">
        <div><p className="eyebrow">Get started</p><h2 id="fast-setup-title">{compact ? nextAction : "Place your first bet."}</h2></div>
        <span className="status-pill active">{step}/3 ready</span>
      </div>
      <p className="onboarding-intro">{compact ? "One setup path. Small devnet stake. Proof-backed settlement." : "Set up once, make a small devnet bet, then watch it settle on-chain."}</p>

      <div className="session-envelope" aria-label="Fast Session limits">
        <span>Per position <strong>0.05 SOL</strong></span>
        <span>Session loss limit <strong>0.10 SOL</strong></span>
        <span>Expiry <strong>{state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "6 hours"}</strong></span>
      </div>

      <ol className="setup-steps">
        <li className={publicKey ? "complete" : "current"}>
          <span>01</span><div><strong>Connect your wallet</strong><small>{publicKey ? "Wallet connected" : "This identifies your position."}</small></div>
        </li>
        <li className={state.delegated ? "complete" : publicKey ? "current" : ""}>
          <span>02</span><div><strong>Enable Fast Session</strong><small>{state.delegated ? "No popup within your chosen limit." : "One approval. 0.10 SOL maximum stake. Pause it anytime."}</small></div>
        </li>
        <li className={state.delegated ? "current" : ""}>
          <span>03</span><div><strong>Place your first bet</strong><small>Choose YES or NO on a live market.</small></div>
        </li>
      </ol>

      {!publicKey && <button type="button" className="session-action" onClick={() => setVisible(true)}>Connect wallet <span>→</span></button>}
      {publicKey && !state.delegated && <button type="button" className="session-action" disabled={busy !== null} onClick={() => void run("delegate")}>{busy === "delegate" ? "Activating Fast Session…" : "Enable Fast Session"}<span>→</span></button>}
      {state.delegated && <Link className="session-action setup-read-action" href={marketHref}>Place your first bet <span>→</span></Link>}
      {state.delegated && <button type="button" className="session-revoke" disabled={busy !== null} onClick={() => void run("revoke")}>{busy === "revoke" ? "Pausing session…" : "Pause and revoke session"}</button>}
      {error && <p className="session-error">{error}</p>}
      <p className="setup-boundary">Devnet only · local signing · pause anytime</p>
    </aside>
  );
}
