"use client";

import { useEffect, useRef, useState } from "react";
import { MatchClock } from "./MatchClock";

interface LiveEvent {
  id: string;
  type: string;
  label: string;
  team?: string;
  ts: number;
}

export interface MatchPhaseState {
  matchId: string;
  statusId: number;
  phaseLabel: string;
  phaseStartedAt: number;
  score: { home: number; away: number };
  homeTeam: string;
  awayTeam: string;
}

interface SSEMessage {
  type: "init" | "event";
  matchId: string;
  event?: LiveEvent;
  phase?: MatchPhaseState;
  recentEvents?: LiveEvent[];
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://144.202.117.160:18766";

/**
 * Resolve the SSE endpoint. In the browser we always go through the
 * Next.js proxy (/api/events/stream) so we're never blocked by Mixed
 * Content restrictions on HTTPS deployments. The raw agent URL is only
 * used server-side or in local dev where the page is already HTTP.
 */
function sseUrl(matchId: string): string {
  const params = new URLSearchParams({ matchId });
  if (typeof window !== "undefined") {
    // Browser — use the same-origin HTTPS proxy
    return `/api/events/stream?${params}`;
  }
  // Server-side (shouldn't happen for an EventSource, but be safe)
  return `${AGENT_URL}/events/stream?${params}`;
}

const PHASE_COLORS: Record<string, string> = {
  "1st Half": "#00ff88",
  "2nd Half": "#00ff88",
  "Extra Time": "#f59e0b",
  Penalties: "#f59e0b",
  Halftime: "#3b82f6",
  "Full Time": "#6366f1",
  Interrupted: "#ff4444",
  Resumed: "#00ff88",
};

// Module-level mute flag — the nav toggle flips this. Default ON for
// desktop; the toggle persists the user's choice in localStorage.
const SOUND_KEY = "stoppage:match_sounds";
let soundEnabled =
  typeof window !== "undefined" ? localStorage.getItem(SOUND_KEY) !== "off" : true;

export function setMatchSoundsEnabled(enabled: boolean) {
  soundEnabled = enabled;
  if (typeof window !== "undefined") localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
}

export function getMatchSoundsEnabled(): boolean {
  return soundEnabled;
}

function playEventSound(type: string) {
  if (typeof window === "undefined" || !soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === "goal_scored" || type === "own_goal") {
      // Arpeggio chime for goals
      osc.type = "triangle";
      osc.frequency.setValueAtTime(330, now); // E4
      osc.frequency.setValueAtTime(440, now + 0.1); // A4
      osc.frequency.setValueAtTime(554, now + 0.2); // C#5
      osc.frequency.setValueAtTime(660, now + 0.3); // E5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.start(now);
      osc.stop(now + 0.8);
    } else if (type === "card_shown") {
      // Warning double tone for cards
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.setValueAtTime(180, now + 0.15); // lower buzz

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      // Light click for other events (corner, substitutions, etc.)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523, now); // C5
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch {
    // AudioContext blocked or unsupported
  }
}

export function LiveMatchBar({ matchId, onNewEvent }: { matchId?: string; onNewEvent?: (event: LiveEvent) => void }) {
  const [phase, setPhase] = useState<MatchPhaseState | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const [phaseTransition, setPhaseTransition] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    const es = new EventSource(sseUrl(matchId));
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const data: SSEMessage = JSON.parse(msg.data);
        if (data.type === "init" && data.phase) {
          setPhase(data.phase);
          if (data.recentEvents) setEvents(data.recentEvents);
        } else if (data.type === "event") {
          if (data.phase) setPhase(data.phase);
          if (data.event) {
            setEvents((prev) => [data.event!, ...prev].slice(0, 30));
            playEventSound(data.event.type);
            if (onNewEvent) onNewEvent(data.event);
          }
        }
      } catch { /* skip malformed */ }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [matchId, onNewEvent]);

  useEffect(() => {
    if (phase?.phaseLabel && prevPhaseRef.current !== null && prevPhaseRef.current !== phase.phaseLabel) {
      setPhaseTransition(phase.phaseLabel);
      const t = setTimeout(() => setPhaseTransition(null), 1500);
      return () => clearTimeout(t);
    }
    prevPhaseRef.current = phase?.phaseLabel ?? null;
  }, [phase?.phaseLabel]);

  useEffect(() => {
    if (!phase?.phaseStartedAt) return;
    const tick = () => setElapsed((Date.now() - phase.phaseStartedAt) / 60000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase?.phaseStartedAt, phase?.phaseLabel]);

  useEffect(() => {
    if (listRef.current && events.length > 0) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  if (!matchId) return null;

  const phaseColor = phase ? PHASE_COLORS[phase.phaseLabel] ?? "#64748b" : "#64748b";
  const stopped = phase?.phaseLabel === "Full Time" || phase?.phaseLabel === "Halftime" || phase?.phaseLabel === "Penalties";
  const isStoppage = phase && !stopped && elapsed > 45;

  return (
    <section className={`live-match-bar ${phaseTransition ? "phase-transition" : ""}`} aria-label="Live match feed" style={{ "--phase-color": phaseColor } as React.CSSProperties}>
      <div className="live-bar-main">
        <MatchClock
          phaseLabel={phase?.phaseLabel}
          phaseStartedAt={phase?.phaseStartedAt}
          homeTeam={phase?.homeTeam}
          awayTeam={phase?.awayTeam}
          score={phase?.score ?? null}
          size={100}
        />
        <div className="live-bar-info">
          <div className="live-bar-top-row">
            <span className="live-bar-phase" style={{ color: phaseColor }}>
              <i style={{ background: phaseColor }} />
              {phase?.phaseLabel ?? "Waiting"}
            </span>
            {phase && !stopped && (
              <span className={`live-bar-clock ${isStoppage ? "stoppage" : ""}`}>
                {formatElapsed(phase.phaseLabel, elapsed)}
              </span>
            )}
            {phase && stopped && (
              <span className="live-bar-fulltime-badge">
                {phase.phaseLabel === "Full Time" ? "FULL TIME" : phase.phaseLabel === "Halftime" ? "HALF TIME" : "PENALTIES"}
              </span>
            )}
          </div>
          <div className="live-bar-team-score">
            <span>{phase?.homeTeam ?? "--"}</span>
            <span className="live-bar-score-num">{phase ? `${phase.score.home}—${phase.score.away}` : "--"}</span>
            <span>{phase?.awayTeam ?? "--"}</span>
          </div>
          <div className="live-bar-meta">
            <span className={`live-bar-dot ${connected ? "live" : "dead"}`} title={connected ? "Connected" : "Disconnected"} />
            <span className="live-bar-events-count">{events.length} event{events.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
      <div className="live-bar-feed" ref={listRef}>
        {events.length === 0 ? (
          <div className="live-bar-empty">Waiting for match events...</div>
        ) : (
          events.map((evt) => (
            <div className={`live-bar-event live-bar-event--${evt.type}`} key={evt.id}>
              <span className="live-bar-event-label">{evt.label}</span>
              <span className="live-bar-event-time">
                {new Date(evt.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>
      <style>{`
        .live-match-bar {
          margin-top: 12px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: linear-gradient(170deg, #0f1a30, #0c1428);
          overflow: hidden;
          transition: border-color .6s ease, box-shadow .6s ease;
        }
        .live-match-bar.phase-transition {
          border-color: var(--phase-color, var(--lime));
          box-shadow: 0 0 24px color-mix(in srgb, var(--phase-color, var(--lime)) 20%, transparent);
        }
        .live-bar-main {
          display: flex;
          gap: 12px;
          padding: 10px 14px;
          align-items: center;
        }
        .live-bar-info {
          flex: 1;
          min-width: 0;
          display: grid;
          gap: 4px;
        }
        .live-bar-top-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .live-bar-phase {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font: 500 10px "DM Mono", monospace;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .live-bar-phase i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .live-bar-clock {
          font: 500 18px "DM Mono", monospace;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
        }
        .live-bar-clock.stoppage {
          color: var(--phase-color, #f59e0b);
          animation: stoppage-pulse 1s ease-in-out infinite;
        }
        @keyframes stoppage-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .6; }
        }
        .live-bar-fulltime-badge {
          font: 700 11px "DM Mono", monospace;
          letter-spacing: .12em;
          color: var(--phase-color, var(--blue));
          animation: fulltime-appear .6s ease-out both;
        }
        @keyframes fulltime-appear {
          from { opacity: 0; transform: scale(.8); }
          to { opacity: 1; transform: scale(1); }
        }
        .live-bar-team-score {
          display: flex;
          align-items: center;
          gap: 8px;
          font: 500 11px "DM Mono", monospace;
          color: var(--muted);
        }
        .live-bar-team-score span:first-child,
        .live-bar-team-score span:last-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .live-bar-score-num {
          flex-shrink: 0;
          color: var(--ink);
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .live-bar-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 2px;
        }
        .live-bar-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #ff4444;
          transition: background .3s ease;
          flex-shrink: 0;
        }
        .live-bar-dot.live {
          background: #00ff88;
          box-shadow: 0 0 6px rgba(0,255,136,.6);
        }
        .live-bar-events-count {
          font: 500 8px "DM Mono", monospace;
          color: var(--muted-dim);
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .live-bar-feed {
          max-height: 130px;
          overflow-y: auto;
          border-top: 1px solid var(--line);
          scrollbar-width: thin;
          scrollbar-color: var(--line) transparent;
        }
        .live-bar-feed::-webkit-scrollbar {
          width: 4px;
        }
        .live-bar-feed::-webkit-scrollbar-thumb {
          background: var(--line);
          border-radius: 2px;
        }
        .live-bar-event {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 14px;
          font-size: 10px;
          line-height: 1.4;
          border-bottom: 1px solid rgba(255,255,255,.04);
          animation: slide-in 200ms ease-out both;
        }
        .live-bar-event:last-child {
          border-bottom: 0;
        }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .live-bar-event--goal_scored,
        .live-bar-event--own_goal,
        .live-bar-event--penalty_awarded {
          color: #00ff88;
        }
        .live-bar-event--card_shown {
          color: #ff958c;
        }
        .live-bar-event--substitution,
        .live-bar-event--shot_taken {
          color: #94a3b8;
        }
        .live-bar-event--var_review {
          color: #f59e0b;
        }
        .live-bar-event-label {
          min-width: 0;
          word-break: break-word;
        }
        .live-bar-event-time {
          flex-shrink: 0;
          color: var(--muted-dim);
          font-variant-numeric: tabular-nums;
        }
        .live-bar-empty {
          padding: 20px 14px;
          color: var(--muted-dim);
          font: 500 9px "DM Mono", monospace;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: .06em;
        }
      `}</style>
    </section>
  );
}

function formatElapsed(phaseLabel: string, elapsed: number): string {
  switch (phaseLabel) {
    case "1st Half": {
      const m = Math.floor(elapsed);
      if (m <= 45) return `${m}'`;
      return `45+${Math.ceil(elapsed - 45)}'`;
    }
    case "2nd Half": {
      const m = elapsed + 45;
      if (m <= 90) return `${Math.floor(m)}'`;
      return `90+${Math.ceil(elapsed - 45)}'`;
    }
    case "Extra Time": {
      const m = elapsed + 90;
      if (m <= 105) return `${Math.floor(m)}'`;
      return `105+${Math.ceil(elapsed + 90 - 105)}'`;
    }
    default:
      return `${Math.floor(elapsed)}'`;
  }
}
