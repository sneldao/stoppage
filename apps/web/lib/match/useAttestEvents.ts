"use client";

import { useEffect, useMemo, useState } from "react";
import {
  toAttestInfo,
  deriveAttestState,
  type AttestEventInfo,
} from "./attest";

const POLL_MS = 5 * 60 * 1000;

/**
 * The full upcoming operator-attested fixture list (MLS/EPL), as a
 * matchId→info map. One cheap fetch per surface — used for friendly match
 * labels + kickoff times on the /match picker and the markets tape (the
 * tsdb:* markets are already bettable; this just gives the group a real
 * name and kickoff). Live score polling is handled per-event by useAttestEvent.
 */
export function useAttestEvents() {
  const [events, setEvents] = useState<AttestEventInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/tsdb-events");
        if (!res.ok) throw new Error(`tsdb-events ${res.status}`);
        const json = (await res.json()) as { events: Parameters<typeof toAttestInfo>[0][] };
        if (!cancelled) setEvents((json.events ?? []).map(toAttestInfo));
      } catch {
        /* non-fatal */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const { byMatchId, pending } = useMemo(() => {
    const map = new Map<string, AttestEventInfo>();
    for (const e of events) {
      const withClock = { ...e, ...deriveAttestState(e) };
      map.set(withClock.matchId, withClock);
    }
    return { byMatchId: map, pending: events.length === 0 };
  }, [events]);

  return { events, byMatchId, pending };
}