"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { impliedProbability, type Market } from "@stoppage/sdk";
import type { Fixture } from "@stoppage/txline";
import { ElectricBorder } from "@/components/ElectricBorder";
import { LiveMatchBar } from "@/components/LiveMatchBar";
import { formatSol as SOL, formatMarketQuestion, countryFlag } from "@/lib/format";

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
  ts: number;
}

interface LastSettled {
  question: string;
  outcome: "yes" | "no";
  marketId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapshotIsFresh(snapshot: LiveMatchSnapshot | null) {
  if (!snapshot?.updatedAt) return false;
  const ts = snapshot.updatedAt < 1_000_000_000_000
    ? snapshot.updatedAt * 1_000
    : snapshot.updatedAt;
  return Date.now() - ts <= 45_000;
}

function safeStartTime(fixture: Fixture): Date {
  const raw = fixture.StartTime as unknown;
  if (typeof raw === "number") return new Date(raw < 1_000_000_000_000 ? raw * 1000 : raw);
  if (typeof raw === "string") return new Date(raw);
  return new Date(0);
}

function useCountdown(target: Date | null): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setLabel("Now"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      const days = Math.floor(h / 24);
      setLabel(days > 1 ? `${days}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [target]);
  return label;
}

// ─── EventTicker ──────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  goal_scored: "⚽",
  own_goal: "⚽",
  card_shown: "🟨",
  corner_awarded: "🚩",
  substitution: "🔄",
  var_review: "📺",
  penalty_awarded: "⚡",
};

function EventTicker({ events }: { events: LiveEvent[] }) {
  const recent = events.slice(0, 6);
  if (recent.length === 0) return null;

  return (
    <div className="event-ticker" aria-label="Recent match events" aria-live="polite">
      <div className="event-ticker-track">
        {/* Duplicate for seamless loop */}
        {[...recent, ...recent].map((evt, i) => (
          <span key={`${evt.id}-${i}`} className={`ticker-item ticker-item--${evt.type}`}>
            <span className="ticker-icon">{EVENT_ICONS[evt.type] ?? "·"}</span>
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
  onNewEvent,
  onEvents,
}: {
  fixture: Fixture | null;
  snapshot: LiveMatchSnapshot | null;
  signalVersion: number;
  recentFixtures: Fixture[];
  onNewEvent?: (evt: LiveEvent) => void;
  onEvents: (evts: LiveEvent[]) => void;
}) {
  const live = fixture?.GameState === 2 || fixture?.GameState === 4;
  const fresh = snapshotIsFresh(snapshot);
  const kickoff = fixture && !live ? safeStartTime(fixture) : null;
  const countdown = useCountdown(kickoff);

  // Intercept events to bubble them up for the ticker
  const handleNewEvent = useCallback((evt: LiveEvent) => {
    onNewEvent?.(evt);
  }, [onNewEvent]);

  return (
    <div className="instrument-face-content instrument-match-content">
      <div className="signal-grid" aria-hidden="true">
        {Array.from({ length: 64 }, (_, i) => <i key={i} />)}
      </div>
      {signalVersion > 0 && (
        <div className="signal-ripple" key={signalVersion} aria-hidden="true">
          <i /><i /><i />
        </div>
      )}

      <div className="match-board-top">
        <span className={live ? "match-live" : "match-next"}>
          <i /> {live ? "Live" : "Next fixture"}
        </span>
        <span>{live ? (fresh ? "Feed current" : "Feed delayed") : "Live match data"}</span>
      </div>

      <div className="scoreline">
        <strong>{fixture?.Participant1 ?? "—"}</strong>
        <span className={`score ${signalVersion > 0 ? "score-flash" : ""}`} key={signalVersion}>
          {live && snapshot ? `${snapshot.score.home}—${snapshot.score.away}` : "vs"}
        </span>
        <strong>{fixture?.Participant2 ?? "—"}</strong>
      </div>

      <div className="match-board-foot">
        <span>
          <span className="match-country-flag">{countryFlag(fixture?.Country ?? "")}</span>{" "}
          {fixture?.Country ?? "World Cup"}
        </span>
        <span>
          {live && snapshot
            ? `Corners ${snapshot.stats.corners} · Cards ${snapshot.stats.cards}`
            : kickoff && countdown
            ? `Kicks off in ${countdown}`
            : "Waiting for fixture"}
        </span>
      </div>

      {/* Recent results strip — shown when no live match */}
      {!live && recentFixtures.length > 0 && (
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

      {fixture && (
        <LiveMatchBar
          matchId={`${fixture.Participant1.trim().split(/\s+/).pop()!.slice(0, 3).toUpperCase()}-${fixture.Participant2.trim().split(/\s+/).pop()!.slice(0, 3).toUpperCase()}`}
          onNewEvent={handleNewEvent as any}
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
        Closes {new Date(market.closesAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · independently resolvable
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

const FACE_INTERVAL_MS = 6_000;
const SWAP_DURATION_MS = 460; // must match CSS transition duration
const SIGNAL_DWELL_MS  = 4_000;

interface LiveInstrumentProps {
  fixture: Fixture | null;
  snapshot: LiveMatchSnapshot | null;
  market: Market | null;
  /** True during the first markets fetch — the empty face shows a loading
   *  label instead of implying no markets exist. */
  marketsLoading?: boolean;
  signalVersion: number;
  lastSignalType: "goal" | "corner" | "card" | null;
  allFixtures: Fixture[];
  onNewEvent?: (evt: any) => void;
}

export function LiveInstrument({
  fixture,
  snapshot,
  market,
  marketsLoading = false,
  signalVersion,
  lastSignalType,
  allFixtures,
  onNewEvent,
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

  // Fetch last settled market for empty market face
  useEffect(() => {
    if (market) return;
    void fetch("/api/board")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const id = data?.entries?.[0]?.proofMarketIds?.[0];
        if (id) setLastSettled({ question: "Last resolved market", outcome: "yes", marketId: id as string });
      })
      .catch(() => {});
  }, [market]);

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

  // Auto-rotate every 6 s when not paused or signal-locked
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      if (!paused && !signalLockRef.current) {
        swapTo(front === 0 ? 1 : 0);
      }
    }, FACE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, front, swapTo]);

  const recentFixtures = allFixtures.filter(
    (f) => f.GameState !== 2 && f.GameState !== 4 && f.FixtureId !== fixture?.FixtureId,
  ).slice(0, 2);

  const live = fixture?.GameState === 2 || fixture?.GameState === 4;

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
              onNewEvent={handleNewEvent}
              onEvents={setEvents}
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
