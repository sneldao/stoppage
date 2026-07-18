import type { NormalizedEvent } from "@stoppage/txline";
import { GamePhase } from "@stoppage/txline";

export interface MatchPhaseState {
  matchId: string;
  statusId: number;
  phaseLabel: string;
  phaseStartedAt: number;
  score: { home: number; away: number };
  homeTeam: string;
  awayTeam: string;
}

export interface LiveEvent {
  id: string;
  type: NormalizedEvent["type"];
  label: string;
  team?: string;
  ts: number;
}

export class LiveStore {
  private phases = new Map<string, MatchPhaseState>();
  private recentEvents = new Map<string, LiveEvent[]>();
  private sseClients = new Set<http.ServerResponse>();
  private maxEvents = 50;

  updateFromEvent(event: NormalizedEvent, homeTeam: string, awayTeam: string, score: { home: number; away: number }): void {
    if (event.type === "heartbeat") return;

    const matchId = event.matchId;
    if (!matchId) return;

    const phaseLabel = phaseLabelForEvent(event);
    const statusId = statusIdForEvent(event);
    if (!this.phases.has(matchId)) {
      this.phases.set(matchId, {
        matchId,
        statusId: statusId ?? 0,
        phaseLabel: phaseLabel ?? "",
        phaseStartedAt: event.ts,
        score,
        homeTeam,
        awayTeam,
      });
    }

    if (phaseLabel) {
      const prev = this.phases.get(matchId)!;
      if (prev.phaseLabel !== phaseLabel) {
        this.phases.set(matchId, { ...prev, statusId: statusId ?? prev.statusId, phaseLabel, phaseStartedAt: event.ts, score });
      } else {
        this.phases.set(matchId, { ...prev, score });
      }
    } else {
      const prev = this.phases.get(matchId)!;
      this.phases.set(matchId, { ...prev, score });
    }

    const liveEvent: LiveEvent = {
      id: `${event.fixtureId}-${event.type}-${event.ts}-${Math.random().toString(36).slice(2, 6)}`,
      type: event.type,
      label: summarizeEvent(event),
      team: "team" in event && typeof (event as Record<string, unknown>).team === "string" ? (event as Record<string, unknown>).team as string : undefined,
      ts: event.ts,
    };

    const buf = this.recentEvents.get(matchId) ?? [];
    buf.push(liveEvent);
    if (buf.length > this.maxEvents) buf.shift();
    this.recentEvents.set(matchId, buf);

    this.broadcast({ type: "event", matchId, event: liveEvent, phase: this.phases.get(matchId) });
  }

  getPhase(matchId: string): MatchPhaseState | undefined {
    return this.phases.get(matchId);
  }

  getRecentEvents(matchId: string): LiveEvent[] {
    return this.recentEvents.get(matchId) ?? [];
  }

  addClient(res: http.ServerResponse): void {
    this.sseClients.add(res);
    res.on("close", () => this.sseClients.delete(res));
  }

  removeClient(res: http.ServerResponse): void {
    this.sseClients.delete(res);
  }

  private broadcast(data: unknown): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}

import http from "node:http";

function phaseLabelForEvent(event: NormalizedEvent): string | null {
  switch (event.type) {
    case "match_started": return "1st Half";
    case "halftime": return "Halftime";
    case "second_half_started": return "2nd Half";
    case "extra_time_started": return "Extra Time";
    case "penalty_shootout_started": return "Penalties";
    case "match_interrupted": return "Interrupted";
    case "match_resumed": return "Resumed";
    case "match_ended": return "Full Time";
    default: return null;
  }
}

function statusIdForEvent(event: NormalizedEvent): number | null {
  switch (event.type) {
    case "match_started": return GamePhase.FirstHalf;
    case "halftime": return GamePhase.Halftime;
    case "second_half_started": return GamePhase.SecondHalf;
    case "extra_time_started": return GamePhase.ExtraTimeFirstHalf;
    case "penalty_shootout_started": return GamePhase.PenaltyShootout;
    case "match_interrupted": return GamePhase.Interrupted;
    case "match_ended": return GamePhase.Finished;
    default: return null;
  }
}

function summarizeEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "match_started": return "Match started";
    case "goal_scored": return `${event.team} goal!`;
    case "own_goal": return `${event.team} own goal`;
    case "corner_awarded": return `${event.team} corner`;
    case "card_shown": return `${event.team} ${event.cardType} card`;
    case "halftime": return "Halftime";
    case "second_half_started": return "Second half";
    case "extra_time_started": return "Extra time";
    case "penalty_shootout_started": return "Penalty shootout";
    case "match_ended": return "Full time";
    case "match_interrupted": return "Match interrupted";
    case "match_resumed": return "Match resumed";
    case "shot_taken": return `${event.team} shot${event.outcome ? ` (${event.outcome})` : ""}`;
    case "substitution": return `${event.team} sub${event.playerOn ? ` — ${event.playerOn}` : ""}`;
    case "var_review": return `VAR check${event.decision ? `: ${event.decision}` : ""}`;
    case "free_kick_awarded": return `${event.team} free kick${event.kickType ? ` (${event.kickType})` : ""}`;
    case "penalty_awarded": return `${event.team} penalty!`;
    case "raw_action": return `${event.team ? `${event.team} ` : ""}${event.action.replace(/_/g, " ")}`;
    default: return "";
  }
}
