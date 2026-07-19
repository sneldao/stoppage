"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useStoppageStore } from "@/store";
import { useState } from "react";

interface SetupPromptProps {
  marketHref?: string;
}

/**
 * Persistent three-step onboarding guide for the homepage hero.
 *
 * The required path is Connect → Place a small bet. One-tap betting (the
 * Fast Session mechanism) is an OPTIONAL acceleration offered only after
 * the user has placed at least one bet via standard wallet approval — so
 * the user experiences the core value before being asked to delegate.
 *
 * Renders one primary action at a time, plus a persistent step indicator
 * so the user always knows where they are in the journey.
 */
export function SetupPrompt({ marketHref = "/markets" }: SetupPromptProps) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { state, delegate, revoke } = useSessionKey();
  const positions = useStoppageStore((s) => s.positions);
  const [busy, setBusy] = useState<"delegate" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPlacedBet = publicKey ? Object.keys(positions).length > 0 : false;

  // Step completion
  const step1Done = Boolean(publicKey);
  const step2Done = hasPlacedBet;
  const step3Done = state.delegated;

  // Current step (1-indexed)
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0;

  const run = async (action: "delegate" | "revoke") => {
    setBusy(action);
    setError(null);
    try {
      await (action === "delegate" ? delegate() : revoke());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const stepClass = (done: boolean, current: boolean) =>
    `setup-step ${done ? "setup-step--done" : ""} ${current ? "setup-step--current" : ""}`;

  return (
    <div id="setup-prompt" className="setup-guide" role="status" aria-live="polite">
      <ol className="setup-guide-steps" aria-label="Getting started">
        <li className={stepClass(step1Done, currentStep === 1)}>
          <span className="setup-step-num">{step1Done ? "✓" : "1"}</span>
          <span className="setup-step-label">Connect wallet</span>
        </li>
        <li className={stepClass(step2Done, currentStep === 2)}>
          <span className="setup-step-num">{step2Done ? "✓" : "2"}</span>
          <span className="setup-step-label">Place a small bet</span>
        </li>
        <li className={stepClass(step3Done, currentStep === 3)}>
          <span className="setup-step-num">{step3Done ? "✓" : "3"}</span>
          <span className="setup-step-label">One-tap betting <small>optional</small></span>
        </li>
      </ol>

      {/* One primary action at a time */}
      <div className="setup-guide-action">
        {/* Step 1: Connect wallet */}
        {!step1Done && (
          <>
            <span className="setup-guide-hint">Devnet test funds · results verified automatically</span>
            <button type="button" className="setup-guide-cta" onClick={() => setVisible(true)}>
              Connect wallet <span>→</span>
            </button>
          </>
        )}

        {/* Step 2: Place a small bet (wallet approval — no session needed).
            Covers both "no session" and "delegated early" — either way the
            user still needs to place their first bet. */}
        {step1Done && !step2Done && (
          <>
            {step3Done && (
              <span className="setup-guide-status">
                <i className="live-dot" /> One-tap betting on · no popups
              </span>
            )}
            <span className="setup-guide-hint">
              Pick YES or NO on a live market · wallet approves each bet
            </span>
            <Link href={marketHref} className="setup-guide-cta">
              {marketHref === "/markets" ? "Browse markets" : "Place your first bet"} <span>→</span>
            </Link>
          </>
        )}

        {/* Step 3 (optional): Offer one-tap betting after first bet */}
        {step1Done && step2Done && !step3Done && (
          <>
            <span className="setup-guide-hint">
              Want future bets without wallet popups? Enable one-tap betting.
            </span>
            {error && <span className="setup-guide-error">{error}</span>}
            <button
              type="button"
              className="setup-guide-cta setup-guide-cta--secondary"
              disabled={busy !== null}
              onClick={() => void run("delegate")}
            >
              {busy === "delegate" ? "Activating…" : "Enable one-tap betting"} <span>→</span>
            </button>
          </>
        )}

        {/* All done — one-tap betting active, has placed bets */}
        {step1Done && step2Done && step3Done && (
          <>
            <span className="setup-guide-status">
              <i className="live-dot" /> One-tap betting on · no popups
            </span>
            <Link href={marketHref} className="setup-guide-cta">
              Browse markets <span>→</span>
            </Link>
            <button
              type="button"
              className="setup-guide-revoke"
              disabled={busy !== null}
              onClick={() => void run("revoke")}
            >
              {busy === "revoke" ? "Pausing…" : "Pause one-tap"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
