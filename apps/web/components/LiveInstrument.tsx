"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { ElectricBorder } from "@/components/ElectricBorder";
import { LiveMatchBar } from "@/components/LiveMatchBar";
import { oracleInfoFor } from "@/lib/oracle";
import { formatSol as SOL, formatMarketQuestion, countryFlag } from "@/lib/format";
import { safeStartTime, useCountdown } from "@/lib/time/useCountdown";
import { useStoppageStore } from "@/store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveMatchSnapshot {
  updatedAt: number | null;
  score: { home: number; away: number };
  stats: { corners: number; cards: number };
}

interface LiveEvent {
  id: string;
  type: string;
  label: string;
  /** Set on `card_shown` events — drives the red/yellow glyph in the ticker. */
  cardType?: "yellow" | "red";
  ts: number;
}

interface LastSettled {
  question: string;
  outcome: "yes" | "no";
  marketId: string;
}

/** Fired by the scripted preview loop on each goal/corner/card beat. */
export type PreviewBeatHandler = (kind: "goal" | "corner" | "card", team: string | null) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapshotIsFresh(snapshot: LiveMatchSnapshot | null) {
  if (!snapshot?.updatedAt) return false;
  const ts = snapshot.updatedAt < 1_000_000_000_000
    ? snapshot.updatedAt * 1_000
    : snapshot.updatedAt;
  return Date.now() - ts <= 45_000;
}



// ─── EventTicker ──────────────────────────────────────────────────────────────

/** Drawn event glyphs — one consistent stroke, colored by the ticker's
 *  per-type CSS (currentColor). Replaces emoji so the ticker renders the
 *  same on every platform. */
function EventIcon({ type, cardType }: { type: string; cardType?: "yellow" | "red" }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (type) {
    case "goal_scored":
    case "own_goal":
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="5.6" {...stroke} />
          <path d="M8 8l3.4-1.7M8 8L6.6 4.6M8 8l-3.4 1.2" {...stroke} strokeWidth="1.1" />
        </svg>
      );
    case "card_shown": {
      // A card keeps its own color — the semantic (red/yellow) must not inherit.
      const fill = cardType === "red" ? "#ef4444" : "#fbbf24";
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="4.5" y="2.5" width="7" height="11" rx="1.5" fill={fill} />
        </svg>
      );
    }
    case "corner_awarded":
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M6.5 14V4.5M6.5 4.5l5.5 1.9L6.5 8.3" {...stroke} />
        </svg>
      );
    case "substitution":
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 5.5h7M8.5 3.5l2 2-2 2M13 10.5H6M7.5 8.5l-2 2 2 2" {...stroke} />
        </svg>
      );
    case "var_review":
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="10" height="7" rx="1" {...stroke} />
          <path d="M8 11v1.5M6 13.5h4" {...stroke} strokeWidth="1.2" />
        </svg>
      );
    case "penalty_awarded":
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M9.2 2l-4.6 7h3.1l-.7 5 4.4-7H8.8l.4-5z" fill="currentColor" />
        </svg>
      );
    default:
      return <span aria-hidden="true">·</span>;
  }
}

function EventTicker({ events }: { events: LiveEvent[] }) {
  const recent = events.slice(0, 6);
  if (recent.length === 0) return null;

  return (
    <div className="event-ticker" aria-label="Recent match events" aria-live="polite">
      <div className="event-ticker-track">
        {/* Duplicate for seamless loop */}
        {[...recent, ...recent].map((evt, i) => (
          <span key={`${evt.id}-${i}`} className={`ticker-item ticker-item--${evt.type}`}>
            <span className="ticker-icon"><EventIcon type={evt.type} cardType={evt.cardType} /></span>
            {evt.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Match Face ───────────────────────────────────────────────────────────────

function MatchFace({
  fixture,
  snapshot,
  signalVersion,
  recentFixtures,
  matchId,
  replay = false,
  preview = false,
  onPhase,
  onNewEvent,
  onEvents,
  onPreviewBeat,
}: {
  fixture: Fixture | null;
  snapshot: LiveMatchSnapshot | null;
  signalVersion: number;
  recentFixtures: Fixture[];
  matchId?: string;
  replay?: boolean;
  preview?: boolean;
  onPhase?: (phase: { score: { home: number; away: number }; phaseLabel?: string }) => void;
  onNewEvent?: (evt: LiveEvent) => void;
  onEvents: (evts: LiveEvent[]) => void;
  onPreviewBeat?: (cb: PreviewBeatHandler | null) => void;
}) {
  const live = fixture?.GameState === 2 || fixture?.GameState === 4;
  const fresh = snapshotIsFresh(snapshot);
  const kickoff = fixture && !live ? safeStartTime(fixture) : null;
  const countdown = useCountdown(kickoff);
  // A replay/preview is effectively live (score ticks) but badged honestly.
  const showLive = live || replay || preview;

  // Intercept events to bubble them up for the ticker
  const handleNewEvent = useCallback((evt: LiveEvent) => {
    onNewEvent?.(evt);
  }, [onNewEvent]);

  // Preview runs its own scripted loop — mirror the beats into the
  // ticker so the demo card keeps a visible pulse without an SSE feed.
  useEffect(() => {
    if (!preview || !onPreviewBeat) return;
    let seq = 0;
    onPreviewBeat((kind, team) => {
      seq += 1;
      const type = kind === "goal" ? "goal_scored" : kind === "card" ? "card_shown" : "corner_awarded";
      handleNewEvent({
        id: `preview-${seq}`,
        type,
        label:
          kind === "goal" ? `GOAL · ${team ?? ""}`.trim()
          : kind === "card" ? `Card · ${team ?? ""}`.trim()
          : "Corner",
        ts: Date.now(),
      });
    });
    return () => onPreviewBeat(null);
  }, [preview, onPreviewBeat, handleNewEvent]);

  // Derive the SSE matchId from the server-attached id (fixture-scoped).
  // Do not re-derive from participant names — that diverges from the agent
  // after matchIdFromFixture gained a FixtureId suffix.
  const resolvedMatchId =
    matchId ??
    (fixture as (Fixture & { matchId?: string }) | null)?.matchId ??
    undefined;
  // Operator-attested ("tsdb:*") matches have no TxLINE SSE stream — the score
  // comes from the `snapshot` prop. Suppress the live bar so we don't open an
  // orphan EventSource for an id the agent will never emit.
  const feedMatchId = (resolvedMatchId ?? "").startsWith("tsdb:")
    ? undefined
    : resolvedMatchId;

  return (
    <div className={`instrument-face-content instrument-match-content ${(replay || preview) ? "instrument-match-content--replay" : ""}`}>
      <div className={`signal-grid ${!showLive ? "signal-grid--listening" : ""}`} aria-hidden="true">
        {Array.from({ length: 64 }, (_, i) => <i key={i} />)}
      </div>
      {signalVersion > 0 && (
        <div className="signal-ripple" key={signalVersion} aria-hidden="true">
          <i /><i /><i />
        </div>
      )}

      <div className="match-board-top">
        {replay ? (
          <span className="match-replay"><i /> Replay · live pipeline</span>
        ) : preview ? (
          <span className="match-preview"><i /> Preview · no live data</span>
        ) : (
          <span className={live ? "match-live" : "match-next"}>
            <i /> {live ? "Live" : "Next fixture"}
          </span>
        )}
        <span>{showLive ? (replay ? "Feed current" : preview ? "Scripted demo" : fresh ? "Feed current" : "Feed delayed") : "Live match data"}</span>
      </div>

      <div className="scoreline">
        <strong>{fixture?.Participant1 ?? "—"}</strong>
        <span className={`score ${signalVersion > 0 ? "score-flash" : ""}`} key={signalVersion}>
          {showLive && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}
        </span>
        <strong>{fixture?.Participant2 ?? "—"}</strong>
      </div>

      <div className="match-board-foot">
        <span>
          <span className="match-country-flag">{countryFlag(fixture?.Country ?? "")}</span>{" "}
          {fixture?.Country ?? "World Cup"}
        </span>
        <span>
          {showLive && snapshot
            ? `Corners ${snapshot.stats.corners} · Cards ${snapshot.stats.cards}`
            : kickoff && countdown
            ? `Kicks off in ${countdown}`
            : "Listening for the next match"}
        </span>
      </div>

      {/* Recent results strip — shown when no live match and no replay */}
      {!showLive && recentFixtures.length > 0 && (
        <div className="recent-results">
          {recentFixtures.slice(0, 2).map((f) => (
            <div key={f.FixtureId} className="recent-result-row">
              <span>{f.Participant1}</span>
              <span className="recent-result-sep">·</span>
              <span>{f.Participant2}</span>
              <span className="recent-result-badge">FT</span>
            </div>
          ))}
        </div>
      )}

      {fixture && !preview && (
        <LiveMatchBar
          matchId={feedMatchId}
          onNewEvent={handleNewEvent as any}
          onPhase={onPhase as any}
        />
      )}
    </div>
  );
}

// ─── Market Face ──────────────────────────────────────────────────────────────

function MarketFace({
  market,
  lastSettled,
  marketsLoading = false,
}: {
  market: Market | null;
  lastSettled: LastSettled | null;
  marketsLoading?: boolean;
}) {
  const [pendingStake, setPendingStake] = useState<string | null>(null);
  const STAKES = ["0.01", "0.05", "0.10"];

  if (!market) {
    return (
      <div className="instrument-face-content instrument-market-content instrument-market--empty">
        <p className="eyebrow">Markets</p>
        {marketsLoading ? (
          <>
            <h2>Finding live markets…</h2>
            <p className="market-empty-sub"><span className="skeleton-line skeleton-line--inline" /></p>
          </>
        ) : (
          <>
            <h2>Markets open with the match.</h2>
            <p className="market-empty-sub">The next market appears as soon as it is published.</p>
          </>
        )}

        {lastSettled && (
          <div className="last-settled-preview">
            <p className="eyebrow" style={{ color: "var(--muted-dim)" }}>Last settled</p>
            <div className="last-settled-row">
              <span className="last-settled-q">{lastSettled.question}</span>
              <span className={`last-settled-outcome ${lastSettled.outcome === "yes" ? "outcome--yes" : "outcome--no"}`}>
                {lastSettled.outcome.toUpperCase()} won
              </span>
            </div>
            <a
              href={`https://explorer.solana.com/address/${lastSettled.marketId}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="last-settled-link"
            >
              View proof ↗
            </a>
          </div>
        )}

        <Link className="quiet-link" href="/markets">Browse markets →</Link>
      </div>
    );
  }

  const odds = impliedProbability(market);
  const pool = market.yesPool + market.noPool;
  const href = `/markets/${market.id}`;
  const stakeParam = pendingStake ? `&stake=${pendingStake}` : "";

  return (
    <div className="instrument-face-content instrument-market-content">
      <div className="market-kicker">
        <span className="live-label"><i /> Live market</span>
        <span>{SOL(pool)} pool</span>
      </div>

      <h2 className="instrument-market-title">{formatMarketQuestion(market.predicate)}</h2>
      <p className="market-meta">
        Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {oracleInfoFor(market.oracle).instrumentLine}
      </p>

      <div className="outcome-cells">
        <Link href={`${href}?side=yes${stakeParam}`} className="outcome-cell outcome-yes">
          <span>YES</span>
          <strong>{Math.round(odds.yes * 100)}%</strong>
          <small>{odds.yes > 0 ? `${(1 / odds.yes).toFixed(1)}x` : "Opening"}</small>
        </Link>
        <Link href={`${href}?side=no${stakeParam}`} className="outcome-cell outcome-no">
          <span>NO</span>
          <strong>{Math.round(odds.no * 100)}%</strong>
          <small>{odds.no > 0 ? `${(1 / odds.no).toFixed(1)}x` : "Opening"}</small>
        </Link>
      </div>

      <div className="stake-hint" role="group" aria-label="Quick stake">
        {STAKES.map((s) => (
          <button
            key={s}
            type="button"
            className={`stake-hint-btn${pendingStake === s ? " stake-hint-btn--active" : ""}`}
            onClick={() => setPendingStake(pendingStake === s ? null : s)}
            aria-pressed={pendingStake === s}
          >
            {s}
          </button>
        ))}
        <span className="stake-hint-label">SOL · tap to pre-fill slip</span>
      </div>
    </div>
  );
}

// ─── LiveInstrument ───────────────────────────────────────────────────────────

// Attention-aware rotation: the deck holds while the user is engaged
// (pointer/key/scroll/touch anywhere on the page) and only turns after a
// full quiet window — so the demo stays alive without interrupting a read.
// A real live match holds the match face; the market face is a deliberate
// tap away via the face tabs.
const FACE_QUIET_MS = 14_000;    // stillness required before the first turn
const FACE_INTERVAL_MS = 14_000; // cadence between turns while still quiet
const SWAP_DURATION_MS = 460;    // must match CSS transition duration
const SIGNAL_DWELL_MS  = 4_000;

interface LiveInstrumentProps {
  fixture: Fixture | null;
  snapshot: LiveMatchSnapshot | null;
  market: Market | null;
  /** True during the first markets fetch — the empty face shows a loading
   *  label instead of implying no markets exist. */
  marketsLoading?: boolean;
  /** Override the matchId passed to the internal LiveMatchBar. Used during
   *  replay so the SSE stream connects to the replay's real matchId instead
   *  of the fixture-name-derived one. */
  matchId?: string;
  /** When true, the match face is a replay — badge honestly, treat score as live. */
  replay?: boolean;
  /** When true, the match face is a client-side preview loop (no live data).
   *  Badged honestly as PREVIEW. Suppresses the LiveMatchBar SSE connection. */
  preview?: boolean;
  /** Lift SSE phase updates to the parent (drives the replay scoreline). */
  onPhase?: (phase: { score: { home: number; away: number }; phaseLabel?: string }) => void;
  signalVersion: number;
  lastSignalType: "goal" | "corner" | "card" | null;
  allFixtures: Fixture[];
  onNewEvent?: (evt: any) => void;
  /** Preview-only: registers the callback the scripted loop fires on each
   *  goal/corner/card beat (mirrored into the event ticker). Pass null to
   *  unregister. */
  onPreviewBeat?: (cb: PreviewBeatHandler | null) => void;
}

export function LiveInstrument({
  fixture,
  snapshot,
  market,
  marketsLoading = false,
  matchId,
  replay = false,
  preview = false,
  onPhase,
  signalVersion,
  lastSignalType,
  allFixtures,
  onNewEvent,
  onPreviewBeat,
}: LiveInstrumentProps) {
  // front = index of the currently visible (top) face
  const [front, setFront] = useState<0 | 1>(0); // 0 = match, 1 = market
  const [swapping, setSwapping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [lastSettled, setLastSettled] = useState<LastSettled | null>(null);
  const signalLockRef = useRef(false);
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSignalVersion = useRef(signalVersion);

  // A match is live when the fixture is in play (or in its stoppage window).
  // Hoisted above the rotation effect — a live scoreline holds the match face
  // forward; the market face stays one deliberate tap away via the tabs.
  const live = fixture?.GameState === 2 || fixture?.GameState === 4;

  // Last page-level interaction. Any pointer/key/scroll/touch activity means
  // the user is engaged — the deck holds instead of turning mid-read.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); };
    const kinds: Array<keyof WindowEventMap> = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    kinds.forEach((kind) => window.addEventListener(kind, bump, { passive: true }));
    return () => kinds.forEach((kind) => window.removeEventListener(kind, bump));
  }, []);

  const board = useStoppageStore((s) => s.board);

  const boardLastSettled = useMemo(() => {
    const id = board?.entries?.[0]?.proofMarketIds?.[0];
    if (!id) return null;
    return { question: "Last resolved market", outcome: "yes" as const, marketId: id };
  }, [board]);

  useEffect(() => {
    if (market || !boardLastSettled) return;
    setLastSettled(boardLastSettled);
  }, [market, boardLastSettled]);

  // Collect events for the ticker
  const handleNewEvent = useCallback((evt: LiveEvent) => {
    setEvents((prev) => [evt, ...prev].slice(0, 8));
    onNewEvent?.(evt);
  }, [onNewEvent]);

  // Both cards stay mounted. Changing front lets CSS physically exchange their
  // depth without measuring heights or collapsing the deck mid-transition.
  const swapTo = useCallback((next: 0 | 1) => {
    if (next === front) return;
    if (swapTimerRef.current) clearTimeout(swapTimerRef.current);
    setSwapping(true);
    setFront(next);
    swapTimerRef.current = setTimeout(() => {
      setSwapping(false);
    }, SWAP_DURATION_MS);
  }, [front]);

  useEffect(() => () => {
    if (swapTimerRef.current) clearTimeout(swapTimerRef.current);
    if (signalTimerRef.current) clearTimeout(signalTimerRef.current);
  }, []);

  // Live signal → snap to match face, hold for SIGNAL_DWELL_MS
  useEffect(() => {
    if (signalVersion === prevSignalVersion.current) return;
    prevSignalVersion.current = signalVersion;
    if (signalTimerRef.current) clearTimeout(signalTimerRef.current);
    signalLockRef.current = true;
    swapTo(0);
    signalTimerRef.current = setTimeout(() => {
      signalLockRef.current = false;
    }, SIGNAL_DWELL_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalVersion]);

  // Auto-rotate on desktop only — mobile users tap to flip. The turn is
  // attention-aware: it waits one full quiet window of page stillness, and a
  // live match holds the scoreline forward (the market face stays one
  // deliberate tap away). Autoplay stops the moment the user engages.
  useEffect(() => {
    if (paused) return;
    if (live) return;
    const mobile = window.matchMedia("(max-width: 800px)").matches;
    if (mobile) return;
    let timer = 0;
    const turn = () => {
      const quiet = Date.now() - lastActivityRef.current >= FACE_QUIET_MS;
      if (!paused && !signalLockRef.current && quiet) {
        swapTo(front === 0 ? 1 : 0);
      }
      timer = window.setTimeout(turn, FACE_INTERVAL_MS);
    };
    timer = window.setTimeout(turn, FACE_QUIET_MS);
    return () => window.clearTimeout(timer);
  }, [paused, live, front, swapTo]);

  const recentFixtures = allFixtures.filter(
    (f) => f.GameState !== 2 && f.GameState !== 4 && f.FixtureId !== fixture?.FixtureId,
  ).slice(0, 2);

  return (
    <div
      className="live-instrument"
      onMouseEnter={() => setPaused(true)}
      onFocus={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onBlur={() => setPaused(false)}
    >
      <ElectricBorder
        variant={live ? "blue" : front === 1 && market ? "lime" : "blue"}
        speed={live ? 1.5 : 1.0}
        displacement={live ? 30 : 20}
        active={live || (front === 1 && market?.status === "open")}
      >
        {/* Both faces occupy the same grid cell. The rear card remains visible
            around the right/bottom edge, so the deck reads before it moves. */}
        <div
          className={`instrument-deck instrument-deck--${front === 0 ? "match" : "market"} ${swapping ? "instrument-deck--swapping" : ""}`}
          aria-live="polite"
        >
          {/* Match face */}
          <div
            className={`instrument-face instrument-match ${front === 0 ? "instrument-face--front" : "instrument-face--back"}`}
            aria-hidden={front !== 0}
          >
            <MatchFace
              fixture={fixture}
              snapshot={snapshot}
              signalVersion={signalVersion}
              recentFixtures={recentFixtures}
              matchId={matchId}
              replay={replay}
              preview={preview}
              onPhase={onPhase}
              onNewEvent={handleNewEvent}
              onEvents={setEvents}
              onPreviewBeat={onPreviewBeat}
            />
          </div>

          {/* Market face */}
          <div
            className={`instrument-face instrument-market ${front === 1 ? "instrument-face--front" : "instrument-face--back"}`}
            aria-hidden={front !== 1}
          >
            <MarketFace market={market} lastSettled={lastSettled} marketsLoading={marketsLoading} />
          </div>
        </div>

        {/* Always-visible event ticker */}
        <EventTicker events={events} />

        {/* Explicit face controls — labeled, accessible */}
        <div className="instrument-controls" role="tablist" aria-label="Switch instrument face">
          <button
            type="button"
            role="tab"
            className={`instrument-control ${front === 0 ? "instrument-control--active" : ""}`}
            onClick={() => { setPaused(true); swapTo(0); }}
            aria-selected={front === 0}
          >
            Match
          </button>
          <button
            type="button"
            role="tab"
            className={`instrument-control ${front === 1 ? "instrument-control--active" : ""}`}
            onClick={() => { setPaused(true); swapTo(1); }}
            aria-selected={front === 1}
          >
            Market
          </button>
        </div>
      </ElectricBorder>
    </div>
  );
}
