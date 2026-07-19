"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useState } from "react";

interface SetupPromptProps {
  marketHref?: string;
}

/**
 * Minimal contextual CTA bar for the homepage hero.
 * Renders one instruction + one action based on wallet/session state.
 * Disappears once the user is delegated and has a market to go to.
 */
export function SetupPrompt({ marketHref = "/markets" }: SetupPromptProps) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { state, delegate } = useSessionKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelegate = async () => {
    setBusy(true);
    setError(null);
    try {
      await delegate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session activation failed");
    } finally {
      setBusy(false);
    }
  };

  // State 3: delegated + market available — get out of the way
  if (state.delegated && marketHref !== "/markets") return null;

  // State 3: delegated, no open market yet
  if (state.delegated) {
    return (
      <div id="setup-prompt" className="setup-prompt setup-prompt--ready" role="status">
        <span className="setup-prompt-status">
          <i className="live-dot" />
          Fast Session active · no popups
        </span>
        <Link href={marketHref} className="setup-prompt-cta">
          Browse markets <span>→</span>
        </Link>
      </div>
    );
  }

  // State 2: wallet connected, no session
  if (publicKey) {
    return (
      <div id="setup-prompt" className="setup-prompt setup-prompt--session" role="status">
        <span className="setup-prompt-hint">
          One approval for no-popup bets · 0.10 SOL limit · pause anytime
        </span>
        {error && <span className="setup-prompt-error">{error}</span>}
        <button
          type="button"
          className="setup-prompt-cta"
          disabled={busy}
          onClick={() => void handleDelegate()}
        >
          {busy ? "Activating…" : "Enable Fast Session"} <span>→</span>
        </button>
      </div>
    );
  }

  // State 1: no wallet
  return (
    <div id="setup-prompt" className="setup-prompt setup-prompt--connect">
      <span className="setup-prompt-hint">
        Devnet · local signing · proof-backed settlement
      </span>
      <button
        type="button"
        className="setup-prompt-cta"
        onClick={() => setVisible(true)}
      >
        Connect wallet <span>→</span>
      </button>
    </div>
  );
}
