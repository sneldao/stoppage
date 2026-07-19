"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { impliedProbability, type Market } from "@stoppage/sdk";
import { useSessionKey } from "@/lib/session-key/useSessionKey";
import { useStoppageStore } from "@/store";
import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";

interface PositionsEmptyStateProps {
  /** Force a particular branch (used for visual testing). Default branches
   *  on wallet + session state. */
  variant?: "auto" | "tease" | "nudge" | "nudge-session";
}

// Honest placeholder: shows the *shape* of an OpenPositionCard without
// any visual parallel to a real yes/no position. We deliberately avoid
// the YES/NO pills (a real-position cue) — a lower-strength status chip
// keeps the eye from reading "preview" as "pending open".
function GhostPositionCard() {
  return (
    <div className="ghost-position-card" aria-hidden="true">
      <div className="ghost-position-card-head">
        <span className="pill">awaiting</span>
        <span className="ghost-position-card-label">live call · connect wallet to fill</span>
      </div>
      <p className="ghost-text">Your position plays here — stake, match, and potential return rerender live.</p>
      <div className="ghost-position-card-stats">
        <div>
          <span className="ghost-position-card-label">Stake</span>
          <span className="ghost-text">—</span>
        </div>
        <div>
          <span className="ghost-position-card-label">Odds</span>
          <span className="ghost-text">live</span>
        </div>
        <div>
          <span className="ghost-position-card-label">Potential return</span>
          <span className="ghost-text">—</span>
        </div>
      </div>
    </div>
  );
}

// Compact live-market card. Pulled from the same store the rest of the
// app reads — switching the nudge to a real list (vs. a static "Browse
// markets" button) gives the user something to do *right now*.
function MarketNudgeCard({ market }: { market: Market }) {
  const odds = impliedProbability(market);
  const pool = market.yesPool + market.noPool;
  const closes = new Date(market.closesAt);
  return (
    <Link href={`/markets/${market.id}`} className="empty-state-nudge-card">
      <div className="empty-state-nudge-side" aria-label="Implied odds">
        <span className="pill pill--yes">YES {Math.round(odds.yes * 100)}%</span>
        <span className="pill pill--no">NO {Math.round(odds.no * 100)}%</span>
      </div>
      <div className="empty-state-nudge-q">
        <strong>{formatMarketQuestion(market.predicate)}</strong>
        <small>
          Match {market.predicate.matchId} · {SOL(pool)} pool · closes{" "}
          {closes.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </small>
      </div>
      <span className="empty-state-nudge-cta" aria-hidden="true">
        Open slip →
      </span>
    </Link>
  );
}

export function PositionsEmptyState({ variant = "auto" }: PositionsEmptyStateProps) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { state } = useSessionKey();
  const markets = useStoppageStore((s) => s.markets);
  const marketsLoading = useStoppageStore((s) => s.marketsLoading);

  const sessionActive = state.delegated && !state.paused;

  // Top 3 OPEN markets closing soonest — for a returning user with zero
  // positions, urgency is the stronger nudge. Pool-depth is a secondary
  // tiebreak so a heavily-traded soon-closing market beats a thin-but-urgent one.
  // closesAt tolerates number | string dates elsewhere in the codebase, so coerce
  // via Date to keep the comparator safe for both.
  const openMarkets = useMemo(
    () =>
      Object.values(markets)
        .filter((m) => m.status === "open")
        .sort((a, b) => {
          const closeDiff = new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime();
          if (closeDiff !== 0) return closeDiff;
          return b.yesPool + b.noPool - (a.yesPool + a.noPool);
        })
        .slice(0, 3),
    [markets]
  );

  const connect = useCallback(() => setVisible(true), [setVisible]);

  // ─── Branch A: not connected → TEASE ──────────────────────────────────────
  // Honest placeholders, not faked positions. Connects via the standard
  // wallet modal — same entry point as the home SetupPrompt.
  const showTease = variant === "tease" || (!publicKey && variant === "auto");
  if (showTease) {
    return (
      <section className="empty-state" aria-label="Position preview">
        <div className="empty-state-section">
          <header className="empty-state-section-head">
            <h3>Your live calls, waiting on you.</h3>
            <span className="badge">Preview</span>
          </header>
          <div className="empty-state-ghost-grid">
            <GhostPositionCard />
            <GhostPositionCard />
          </div>
          <p className="empty-state-hint" style={{ marginTop: 16 }}>
            Each card updates from kickoff through settlement — stake, odds, and potential return
            rerender live as the match moves. Settled markets route to the public proof board;
            your form stays personal to this device.
          </p>
          <div className="empty-state-cta-row" style={{ marginTop: 6 }}>
            <span className="empty-state-hint">Devnet · results verified automatically</span>
            <button type="button" className="setup-guide-cta" onClick={connect}>
              Connect wallet <span>→</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ─── Branch B & C: connected but no open positions → NUDGE ────────────────
  // Pull up to 3 currently-OPEN markets. Skip nudge entirely if there are
  // none — fall through to a softer "Listen for next match" message + link.
  const showSessionBadge = sessionActive || variant === "nudge-session";
  const nudgeCopy =
    sessionActive || variant === "nudge-session"
      ? "Pick a market — your bet signs the moment you confirm, no wallet popup."
      : "Pick YES or NO on a live market. Your call appears here the moment it confirms.";

  return (
    <section className="empty-state" aria-label="Markets calling you">
      <div className="empty-state-section">
        <header className="empty-state-section-head">
          <h3>Markets calling you right now.</h3>
          {showSessionBadge ? (
            <span className="badge badge--session">
              <i className="live-dot" /> One-tap on
            </span>
          ) : (
            <span className="badge">Nudge</span>
          )}
        </header>

        {marketsLoading && openMarkets.length === 0 ? (
          <p className="empty-state-empty">
            Watching the live feed for the next open market…
          </p>
        ) : openMarkets.length === 0 ? (
          <div className="empty-state-empty">
            <p>No live matches are open right now.</p>
            <Link href="/markets" className="setup-guide-cta" style={{ marginTop: 12 }}>
              Browse the full tape <span>→</span>
            </Link>
          </div>
        ) : (
          <>
            <div className="empty-state-nudge-grid">
              {openMarkets.map((m) => (
                <MarketNudgeCard key={m.id} market={m} />
              ))}
            </div>
            <p className="empty-state-hint" style={{ marginTop: 14 }}>
              {nudgeCopy}
            </p>
          </>
        )}

        {openMarkets.length > 0 && (
          <div className="empty-state-cta-row" style={{ marginTop: 8 }}>
            <span className="empty-state-hint">Or browse everything on the tape.</span>
            <Link href="/markets" className="setup-guide-cta setup-guide-cta--secondary">
              All markets <span>→</span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

export default PositionsEmptyState;
