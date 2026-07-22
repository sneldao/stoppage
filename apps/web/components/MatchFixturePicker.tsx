"use client";

import Link from "next/link";
import { isFixtureLive } from "@/lib/match/fixtures";
import type { FixtureWithMatchId } from "@/lib/match/types";

interface MatchFixturePickerProps {
  fixtures: FixtureWithMatchId[];
  matchIds: string[];
  selectedMatchId: string | null;
}

function matchLabel(fixture: FixtureWithMatchId | undefined, matchId: string) {
  if (!fixture) return matchId;
  const home = fixture.Participant1.split(/\s+/).pop() ?? fixture.Participant1;
  const away = fixture.Participant2.split(/\s+/).pop() ?? fixture.Participant2;
  return `${home} v ${away}`;
}

export function MatchFixturePicker({ fixtures, matchIds, selectedMatchId }: MatchFixturePickerProps) {
  if (matchIds.length <= 1) return null;

  return (
    <div className="match-fixture-picker" role="tablist" aria-label="Choose match">
      {matchIds.map((matchId) => {
        const fixture = fixtures.find((item) => item.matchId === matchId);
        const active = matchId === selectedMatchId;
        const live = isFixtureLive(fixture);
        return (
          <Link
            key={matchId}
            href={`/match?match=${encodeURIComponent(matchId)}`}
            className={`match-fixture-chip ${active ? "active" : ""} ${live ? "match-fixture-chip--live" : ""}`}
            role="tab"
            aria-selected={active}
          >
            {live && <i className="live-dot" aria-hidden="true" />}
            {matchLabel(fixture, matchId)}
          </Link>
        );
      })}
    </div>
  );
}
