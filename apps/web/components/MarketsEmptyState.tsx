"use client";

import { type TapeFilter, FILTER_LABEL } from "@/lib/markets/tapeFilters";

// Filter-specific messaging. The user picked this filter deliberately —
// treat that choice as binding. No cross-pivot cards (don't drag in markets
// from an unrelated state just to fill space); switching filters is the
// natural next step. `switchTo` is the primary pivot the CTA button hits;
// `switchHint` is the softer secondary text shown beside the button when
// there's another reasonable target worth naming.
const COPY: Record<
  TapeFilter,
  {
    head: string;
    badge: string;
    hint: string;
    switchTo: TapeFilter | null;
    switchHint: string | null;
  }
> = {
  all: {
    head: "Markets appear with the next match.",
    badge: "Initializing",
    hint:
      "Matchkeeper reads the TxLINE feed and publishes a market the moment a match becomes eligible. The page fills itself in — leave it open or tap a filter above to scope the view.",
    switchTo: null,
    switchHint: null,
  },
  open: {
    head: "Nothing is open right now.",
    badge: "Quiet",
    hint:
      "Markets open at kickoff and stay open through the match. The next fixture's slate lands here automatically once Matchkeeper publishes it.",
    switchTo: "settled",
    switchHint: "Or browse Resolved to see how past markets ran.",
  },
  awaiting_settlement: {
    head: "Nothing is settling right now.",
    badge: "Quiet",
    hint:
      "Settlement windows are short — they open at the final whistle and close after the on-chain proof verifies. Try Open while you wait.",
    switchTo: "open",
    switchHint: "Or browse Resolved for past results.",
  },
  settled: {
    head: "No resolved markets yet.",
    badge: "Quiet",
    hint:
      "The first resolved market appears as soon as the first match ends. Settled markets stay on the protocol board with their verification receipts attached.",
    switchTo: "open",
    switchHint: null,
  },
};

interface MarketsEmptyStateProps {
  /** Active filter on the tape — drives header + hint + switch direction. */
  filter: TapeFilter;
  /** True if the underlying market store has ANY markets at all (across
   *  every filter). Distinguishes "world is initializing" from "this
   *  filter is empty by itself". */
  hasAnyMarkets: boolean;
  /** True during the page's background 12s refresh tick (NOT the initial
   *  load). While true and the filter has no matches, swap the badge to
   *  "Syncing" with a pulsing live-dot to signal work-in-progress — but
   *  keep the steady-state copy + CTA unchanged so the reading flow
   *  (which can run alongside the refresh) doesn't flash. */
  marketsLoading?: boolean;
  /** Called when the user clicks the primary pivot button. The parent
   *  owns the filter state — this component stays presentational and
   *  never mutates filters itself. Required: every filter-empty branch
   *  has an actionable primary direction. */
  onSwitchFilter: (next: TapeFilter) => void;
}

export function MarketsEmptyState({
  filter,
  hasAnyMarkets,
  marketsLoading,
  onSwitchFilter,
}: MarketsEmptyStateProps) {
  // Initial-state path: ALL filter is empty AND there are no markets anywhere.
  // This means the store hasn't loaded yet — treat as a "be patient" beat.
  if (filter === "all" && !hasAnyMarkets) {
    const copy = COPY.all;
    return (
      <section className="empty-state" aria-label="Markets initializing">
        <div className="empty-state-section">
          <header className="empty-state-section-head">
            <h3>{copy.head}</h3>
            <span className="badge">{copy.badge}</span>
          </header>
          <p className="empty-state-hint">{copy.hint}</p>
        </div>
      </section>
    );
  }

  // Refresh-gap signal: store already has markets but a background refresh
  // is in flight. Swap ONLY the badge to convey "we're working" without
  // flashing the head/hint text (which the user may be mid-read on). The
  // CTA stays — letting them pivot mid-refresh is faster than waiting.
  const isRefreshing = Boolean(marketsLoading) && hasAnyMarkets;

  // Filter-empty path: store has markets somewhere, just none matching this filter.
  // Frame the empty with copy that respects the filter the user already picked.
  // The CTA row surfaces an actionable button (primary pivot) and a soft text
  // hint naming the secondary pivot if one exists.
  const copy = COPY[filter];
  const primary = copy.switchTo;
  return (
    <section className="empty-state" aria-label={`No ${FILTER_LABEL[filter]} markets`}>
      <div className="empty-state-section">
        <header className="empty-state-section-head">
          <h3>{copy.head}</h3>
          {isRefreshing ? (
            <span className="badge" role="status" aria-live="polite">
              <i className="live-dot" style={{ marginRight: 5, width: 6, height: 6 }} /> Syncing
            </span>
          ) : (
            <span className="badge">{copy.badge}</span>
          )}
        </header>
        <p className="empty-state-hint">{copy.hint}</p>
        {primary && (
          <div className="empty-state-cta-row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="setup-guide-cta setup-guide-cta--secondary"
              onClick={() => onSwitchFilter(primary)}
            >
              Switch to {FILTER_LABEL[primary]} <span>→</span>
            </button>
            {copy.switchHint && <span className="empty-state-hint">{copy.switchHint}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

export default MarketsEmptyState;
