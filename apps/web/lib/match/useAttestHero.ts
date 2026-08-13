"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fixture } from "@stoppage/txline";
import type { LiveMatchSnapshot } from "@/lib/match/types";
import {
  attestEventToFixture,
  attestEventToSnapshot,
  type AttestEventInfo,
} from "./attest";

export interface UpcomingAttestEvent {
  eventId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: string;
  kickoffTs: number | null;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
}

/** How far out an upcoming attest fixture may own the hero countdown
 *  (a distant kickoff should not hijack the reel). */
const LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
/** How far past kickoff an in-play attest fixture stays featured as the live
 *  hero; after this the normal flow (replay/preview) resumes. */
const IN_PLAY_LOOKBACK_MS = 4 * 60 * 60 * 1000;
/** Refresh cadence for the upcoming list. */
const LIST_POLL_MS = 5 * 60 * 1000;
/** Live score poll once the featured match is underway. */
const LIVE_POLL_MS = 20 * 1000;
/** Re-derive started/in-play state on a ticking clock so the kickoff
 *  transition (countdown → live) happens promptly without a list refetch. */
const TICK_MS = 15 * 1000;

/**
 * The operator-attested (TheSportsDB) hero fixture — second match-plane
 * for markets opened under attestation_validator (e.g. tsdb:2406978).
 * TxLINE MLS/EPL fixtures now live in /api/fixtures; this plane stays
 * until those attestation markets close (docs/ATTESTATION-ORACLE.md).
 *
 * Drives the same countdown path as a TxLINE fixture (synthetic Fixture,
 * GameState 1 when scheduled), then flips to the real scoreline once in
 * play (GameState 2), polling /api/tsdb-event/{id} for the live score.
 */
export function useAttestHero() {
  const [events, setEvents] = useState<UpcomingAttestEvent[]>([]);
  const [detail, setDetail] = useState<UpcomingAttestEvent | null>(null);
  const [tick, setTick] = useState(0);

  // Upcoming list — refresh slowly; lives under the attestation plane.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/tsdb-events");
        if (!res.ok) throw new Error(`tsdb-events ${res.status}`);
        const data = (await res.json()) as { events: UpcomingAttestEvent[] };
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        /* non-fatal — hero falls back to the TxLINE/preview planes */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Tick so the scheduled→live boundary flips on its own.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();

  // Featured attest fixture: an in-play or upcoming (not finished) match,
  // earliest kickoff first — so it counts down ahead of kickoff and then
  // shows live while it's on.
  const featured = useMemo(() => {
    return (
      events
        .filter((e) => {
          if (!e.kickoffTs || e.finished) return false;
          const ts = e.kickoffTs * 1000;
          return ts - now <= LOOKAHEAD_MS && now - ts <= IN_PLAY_LOOKBACK_MS;
        })
        .sort((a, b) => (a.kickoffTs ?? 0) - (b.kickoffTs ?? 0))[0] ?? null
    );
  }, [events, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const featuredLive =
    !!featured?.kickoffTs && !featured.finished && featured.kickoffTs * 1000 <= now;

  // Live score poll for the featured match once it's underway.
  useEffect(() => {
    const id = featured?.eventId;
    if (!id || !featuredLive) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tsdb-event/${id}`);
        if (!res.ok) throw new Error(`tsdb-event ${res.status}`);
        const d = (await res.json()) as UpcomingAttestEvent;
        if (!cancelled) setDetail(d);
      } catch {
        /* keep last known detail */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [featured?.eventId, featuredLive]);

  // The live detail carries scores; the list entry carries freshness while
  // it's still scheduled. Once it finishes, drop it so the hero falls back
  // cleanly (no stale "Kicks off in Now" state after full-time).
  const event = featuredLive && detail ? detail : featured;
  const finished = !!event?.finished;
  const started = !!event?.kickoffTs && event.kickoffTs * 1000 <= Date.now();
  const inPlay = !finished && started;

  const fixture = useMemo<Fixture | null>(() => {
    if (!event?.kickoffTs || finished) return null;
    const info: AttestEventInfo = {
      eventId: event.eventId,
      matchId: event.matchId,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      league: event.league,
      kickoffTs: event.kickoffTs,
      finished,
      inPlay,
      homeGoals: event.homeGoals ?? null,
      awayGoals: event.awayGoals ?? null,
    };
    return attestEventToFixture(info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, inPlay, finished]);

  const snapshot = useMemo<LiveMatchSnapshot | null>(() => {
    if (!event?.kickoffTs || finished) return null;
    const info: AttestEventInfo = {
      eventId: event.eventId,
      matchId: event.matchId,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      league: event.league,
      kickoffTs: event.kickoffTs,
      finished,
      inPlay,
      homeGoals: event.homeGoals ?? null,
      awayGoals: event.awayGoals ?? null,
    };
    return attestEventToSnapshot(info);
    // eslint-disable-line react-hooks/exhaustive-deps
  }, [event, inPlay, finished]);

  return { fixture, snapshot, inPlay, featured };
}