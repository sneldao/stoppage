"use client";

import type { BetErrorInfo } from "@/lib/markets/betErrors";

interface SlipErrorCardProps {
  error: BetErrorInfo;
  /** True while a submit/refresh is in flight — disables actions. */
  busy: boolean;
  /** "Try again" — re-runs the same submit. */
  onRetry: () => void;
  /** Contextual primary action: forced wallet path or market refresh. */
  onRetryWallet?: () => void;
  onRefresh?: () => void;
  onDismiss: () => void;
}

/**
 * Structured bet-slip failure card — replaces the bare inline error line.
 * Classifies the failure (lib/markets/betErrors.ts), names what happened,
 * and offers the one recovery action that actually applies. Dismissible,
 * with the raw message available under Details (never silently swallowed).
 */
export function SlipErrorCard({ error, busy, onRetry, onRetryWallet, onRefresh, onDismiss }: SlipErrorCardProps) {
  // Primary action = the classified recovery, falling back to plain retry
  // when the page can't offer the contextual handler.
  const primary =
    error.action === "retry-wallet"
      ? { onClick: onRetryWallet ?? onRetry, label: onRetryWallet ? "Place with wallet approval" : "Try again" }
      : error.action === "refresh"
      ? { onClick: onRefresh ?? onRetry, label: onRefresh ? "Refresh market" : "Try again" }
      : error.action === "retry"
      ? { onClick: onRetry, label: "Try again" }
      : null;
  // "Try again" as a secondary next to a contextual primary.
  const showSecondary = primary !== null && primary.onClick !== onRetry;

  return (
    <div className="slip-error-card" role="alert">
      <button
        type="button"
        className="slip-error-card-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss error"
        disabled={busy}
      >
        ×
      </button>
      <p className="slip-error-card-title">{error.title}</p>
      <p className="slip-error-card-hint">{error.hint}</p>
      {primary && (
        <div className="slip-error-card-actions">
          <button type="button" className="slip-error-card-cta" onClick={primary.onClick} disabled={busy}>
            {busy ? "Working…" : primary.label}
          </button>
          {showSecondary && (
            <button type="button" className="slip-error-card-secondary" onClick={onRetry} disabled={busy}>
              Try again
            </button>
          )}
        </div>
      )}
      {error.raw && error.raw !== error.hint && (
        <details className="slip-error-card-details">
          <summary>Details</summary>
          <code>{error.raw}</code>
        </details>
      )}
    </div>
  );
}
