"use client";

/**
 * Gate-open reminders — localStorage only, no backend.
 *
 * A reminder fires once when a fixture's betting gate opens (kickoff − 2h).
 * Fired ids persist so a reminder never double-fires across sessions;
 * long-finished fixtures are pruned. Dismissal is per session (banner),
 * notification is once ever (Browser Notification, permission-gated).
 */

import type { FixtureWithMatchId } from "@/lib/match/types";

const REMINDERS_KEY = "stoppage:reminders";
const NOTIFIED_KEY = "stoppage:reminders-notified";

export const GATE_OPEN_LEAD_MS = 2 * 3_600_000;
const PRUNE_AFTER_MS = 3 * 3_600_000;

function loadIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveIds(key: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(ids));
}

export function loadReminders(): string[] {
  return loadIds(REMINDERS_KEY);
}

export function toggleReminder(matchId: string): string[] {
  const current = loadIds(REMINDERS_KEY);
  const next = current.includes(matchId)
    ? current.filter((id) => id !== matchId)
    : [...current, matchId];
  saveIds(REMINDERS_KEY, next);
  return next;
}

export function loadNotified(): Set<string> {
  return new Set(loadIds(NOTIFIED_KEY));
}

export function markNotified(matchId: string): void {
  const notified = loadIds(NOTIFIED_KEY);
  if (!notified.includes(matchId)) saveIds(NOTIFIED_KEY, [...notified, matchId]);
}

function startMs(f: FixtureWithMatchId): number {
  const raw = f.StartTime as unknown;
  if (typeof raw === "number") return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  const t = Date.parse(raw as string);
  return Number.isFinite(t) ? t : 0;
}

/** MatchIds whose gate is open right now and haven't fired yet. */
export function dueReminders(fixtures: FixtureWithMatchId[], reminded: string[], notified: Set<string>): FixtureWithMatchId[] {
  const now = Date.now();
  const wanted = new Set(reminded);
  return fixtures.filter((f) => {
    if (!wanted.has(f.matchId) || notified.has(f.matchId)) return false;
    const t = startMs(f);
    if (!Number.isFinite(t) || t <= 0) return false;
    return now >= t - GATE_OPEN_LEAD_MS && now <= t + PRUNE_AFTER_MS;
  });
}

/** Drop reminders for fixtures long finished or vanished from the feed. */
export function pruneReminders(fixtures: FixtureWithMatchId[]): string[] {
  // Never prune against an empty feed — that reads as "everything vanished"
  // during loads and outages, wiping reminders users actually set.
  if (fixtures.length === 0) return loadIds(REMINDERS_KEY);  const now = Date.now();
  const byId = new Map(fixtures.map((f) => [f.matchId, f]));
  const kept = loadIds(REMINDERS_KEY).filter((id) => {
    const f = byId.get(id);
    if (!f) return false;
    const t = startMs(f);
    return Number.isFinite(t) && t > now - PRUNE_AFTER_MS;
  });
  saveIds(REMINDERS_KEY, kept);
  return kept;
}
