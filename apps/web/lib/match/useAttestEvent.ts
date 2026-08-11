"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fixture } from "@stoppage/txline";
import type { LiveMatchSnapshot } from "@/lib/match/types";
import {
  eventIdFromMatchId,
  isAttestMatchId,
  toAttestInfo,
  deriveAttestState,
  attestEventToFixture,
  attestEventToSnapshot,
  type AttestEventInfo,
} from "./attest";

const POLL_MS = 30 * 1000;

/**
 * Per-event attestation context for a specific matchId (e.g. the selected
 * "tsdb:2406978" match on the /match desk). Returns a synthetic Fixture
 * (countdown when scheduled, live when in play) plus a real score snapshot,
 * polling /api/tsdb-event/{id} while the match can be live. Non-attest
 * matchIds return empty — callers fall back to the TxLINE plane.
 */
export function useAttestEvent(matchId: string | null) {
  const eventId = eventIdFromMatchId(matchId);
  const [event, setEvent] = useState<AttestEventInfo | null>(null);
  const [loading, setLoading] = useState(eventId != null);

  useEffect(() => {
    if (eventId == null) {
      setEvent(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const res = await fetch(`/api/tsdb-event/${eventId}`);
        if (!res.ok) throw new Error(`tsdb-event ${res.status}`);
        const json = (await res.json()) as Parameters<typeof toAttestInfo>[0];
        if (!cancelled) setEvent(toAttestInfo(json));
      } catch {
        /* keep last known detail */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      setLoading(false);
    };
  }, [eventId]);

  const clock = deriveAttestState(event ?? {});
  // Overlay clock-derived in-play so the fixture/snapshot builders see it.
  const liveEvent = event ? { ...event, inPlay: clock.inPlay } : null;

  const fixture = useMemo<Fixture | null>(
    () => (liveEvent ? attestEventToFixture(liveEvent) : null),
    [liveEvent]
  );
  const snapshot = useMemo<LiveMatchSnapshot | null>(
    () => (liveEvent ? attestEventToSnapshot(liveEvent) : null),
    [liveEvent]
  );

  return {
    event,
    fixture,
    snapshot,
    inPlay: clock.inPlay,
    started: clock.started,
    isAttest: isAttestMatchId(matchId),
    loading,
  };
}