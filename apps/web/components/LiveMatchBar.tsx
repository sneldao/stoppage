"use client";

import { useEffect, useRef, useState } from "react";

interface LiveEvent {
  id: string;
  type: string;
  label: string;
  team?: string;
  ts: number;
}

interface MatchPhaseState {
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

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://144.202.117.160:8765";

const PHASE_COLORS: Record<string, string> = {
  "1st Half": "#00ff88",
  "2nd Half": "#00ff88",
  "Extra Time": "#f1bb48",
  Penalties: "#f1bb48",
  Halftime: "#64748b",
  "Full Time": "#3b82f6",
  Interrupted: "#ff4444",
  Resumed: "#00ff88",
};

export function LiveMatchBar({ matchId }: { matchId?: string }) {
  const [phase, setPhase] = useState<MatchPhaseState | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchId) return;
    const params = new URLSearchParams({ matchId });
    const es = new EventSource(`${AGENT_URL}/events/stream?${params}`);
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
          if (data.event) setEvents((prev) => [data.event!, ...prev].slice(0, 30));
        }
      } catch { /* skip malformed */ }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [matchId]);

  useEffect(() => {
    if (listRef.current && events.length > 0) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  if (!matchId) return null;

  const phaseColor = phase ? PHASE_COLORS[phase.phaseLabel] ?? "#64748b" : "#64748b";

  return (
    <section className="live-match-bar" aria-label="Live match feed">
      <div className="live-bar-header">
        <span className="live-bar-phase" style={{ color: phaseColor }}>
          <i style={{ background: phaseColor }} />
          {phase?.phaseLabel ?? "Waiting"}
        </span>
        <span className="live-bar-score">
          {phase ? `${phase.homeTeam} ${phase.score.home}—${phase.score.away} ${phase.awayTeam}` : ""}
        </span>
        <span className={`live-bar-dot ${connected ? "live" : "dead"}`} title={connected ? "Connected" : "Disconnected"}>
          <i />
        </span>
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
          border-radius: 4px;
          background: linear-gradient(170deg, #0f172a, #0c1425);
          overflow: hidden;
        }
        .live-bar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--line);
          font: 500 10px "DM Mono", monospace;
          letter-spacing: .05em;
          text-transform: uppercase;
        }
        .live-bar-phase {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .live-bar-phase i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .live-bar-score {
          margin-left: auto;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
        }
        .live-bar-dot i {
          display: block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ff4444;
          transition: background .3s ease;
        }
        .live-bar-dot.live i {
          background: #00ff88;
          box-shadow: 0 0 6px rgba(0,255,136,.6);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: .4; }
        }
        .live-bar-feed {
          max-height: 130px;
          overflow-y: auto;
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
          color: #f1bb48;
        }
        .live-bar-event-label {
          min-width: 0;
          word-break: break-word;
        }
        .live-bar-event-time {
          flex-shrink: 0;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .live-bar-empty {
          padding: 20px 14px;
          color: var(--muted);
          font: 500 9px "DM Mono", monospace;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: .06em;
        }
      `}</style>
    </section>
  );
}
