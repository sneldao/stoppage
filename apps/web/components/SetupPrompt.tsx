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
  const { state, delegate, pause, resume, revoke } = useSessionKey();
  const positions = useStoppageStore((s) => s.positions);
  const [busy, setBusy] = useState<"delegate" | "resume" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rule 9 nudge: default to the suggested cap, but let the user opt out
  // to "no limit" (maxTotalStake: 0). The default is a nudge, not a mandate.
  const [noLimit, setNoLimit] = useState(false);

  const hasPlacedBet = publicKey ? Object.keys(positions).length > 0 : false;

  // Step completion
  const step1Done = Boolean(publicKey);
  const step2Done = hasPlacedBet;
  const step3Done = state.delegated;

  // Current step (1-indexed)
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0;

  const run = async (action: "delegate" | "resume" | "revoke") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "delegate") await delegate({ maxTotalStake: noLimit ? 0 : undefined });
      else if (action === "resume") await resume();
      else await revoke();
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
            <span className="setup-guide-hint setup-guide-hint--disclose">
              Activating moves 0.1 SOL from your wallet into the session key — that fund covers stakes + fees. End session revokes the grant and refunds its rent; the session fund itself stays in the session key's account (a UI sweep is a follow-up, trivial on devnet).
            </span>
            <div className="setup-guide-cap" role="group" aria-label="Session spend cap">
              <span className="setup-guide-cap-label">Self-imposed cap</span>
              <button
                type="button"
                className={`setup-guide-cap-pill ${!noLimit ? "selected" : ""}`}
                aria-pressed={!noLimit}
                onClick={() => setNoLimit(false)}
              >
                0.1 SOL <small>suggested</small>
              </button>
              <button
                type="button"
                className={`setup-guide-cap-pill ${noLimit ? "selected" : ""}`}
                aria-pressed={noLimit}
                onClick={() => setNoLimit(true)}
              >
                No limit
              </button>
            </div>
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
            <div className="setup-guide-session-controls">
              <button
                type="button"
                className="setup-guide-revoke"
                disabled={busy !== null}
                onClick={pause}
                title="Temporarily turn off one-tap. No popup, nothing revoked on-chain — resume anytime. The 0.1 SOL session fund stays in the session key's account regardless."
              >
                Pause one-tap
              </button>
              <button
                type="button"
                className="setup-guide-revoke setup-guide-revoke--destructive"
                disabled={busy !== null}
                onClick={() => void run("revoke")}
                title="Revoke the grant on-chain and refund its rent. The 0.1 SOL session fund stays in the session key's account (not yet sweepable via the UI — follow-up). Self-exclude path — irreversible without a fresh delegation."
              >
                {busy === "revoke" ? "Ending…" : "End session"}
              </button>
            </div>
            {error && <span className="setup-guide-error">{error}</span>}
          </>
        )}

        {/* Paused — one wallet signature brings one-tap back, or End
            session to revoke the grant (revoke now works from the
            paused state because pause keeps the keypair persisted). */}
        {step1Done && state.paused && (
          <>
            <span className="setup-guide-hint">
              One-tap is paused. Resume with one wallet signature (a fresh 6h grant + 0.1 SOL fund).
            </span>
            <span className="setup-guide-hint setup-guide-hint--disclose">
              The previous grant is still on-chain. End session to revoke it and refund its rent — the 0.1 SOL session fund stays in the session key's account (not yet sweepable via the UI).
            </span>
            {error && <span className="setup-guide-error">{error}</span>}
            <button
              type="button"
              className="setup-guide-cta setup-guide-cta--secondary"
              disabled={busy !== null}
              onClick={() => void run("resume")}
            >
              {busy === "resume" ? "Resuming…" : "Resume one-tap betting"} <span>→</span>
            </button>
            <div className="setup-guide-session-controls">
              <button
                type="button"
                className="setup-guide-revoke setup-guide-revoke--destructive"
                disabled={busy !== null}
                onClick={() => void run("revoke")}
                title="Revoke the paused grant on-chain and refund its rent. The 0.1 SOL session fund stays in the session key's account (not yet sweepable via the UI — follow-up). Irreversible without a fresh delegation."
              >
                {busy === "revoke" ? "Ending…" : "End session"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
