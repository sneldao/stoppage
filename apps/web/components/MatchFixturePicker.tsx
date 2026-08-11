"use client";

import Link from "next/link";
import { isFixtureLive } from "@/lib/match/fixtures";
import { isAttestMatchId } from "@/lib/match/attest";
import type { FixtureWithMatchId } from "@/lib/match/types";
import type { AttestEventInfo } from "@/lib/match/attest";

interface MatchFixturePickerProps {
  fixtures: FixtureWithMatchId[];
  matchIds: string[];
  selectedMatchId: string | null;
  /** Upcoming operator-attested match labels, keyed by "tsdb:<id>". */
  attestByMatchId?: Map<string, AttestEventInfo>;
}

function matchLabel(
  fixture: FixtureWithMatchId | undefined,
  matchId: string,
  attestByMatchId?: Map<string, AttestEventInfo>
) {
  if (fixture) {
    const home = fixture.Participant1.split(/\s+/).pop() ?? fixture.Participant1;
    const away = fixture.Participant2.split(/\s+/).pop() ?? fixture.Participant2;
    return `${home} v ${away}`;
  }
  const attest = attestByMatchId?.get(matchId);
  if (attest) {
    const home = attest.homeTeam.split(/\s+/).pop() ?? attest.homeTeam;
    const away = attest.awayTeam.split(/\s+/).pop() ?? attest.awayTeam;
    return `${home} v ${away}`;
  }
  return matchId;
}

export function MatchFixturePicker({ fixtures, matchIds, selectedMatchId, attestByMatchId }: MatchFixturePickerProps) {
  if (matchIds.length <= 1) return null;

  return (
    <div className="match-fixture-picker" role="tablist" aria-label="Choose match">
      {matchIds.map((matchId) => {
        const fixture = fixtures.find((item) => item.matchId === matchId);
        const attest = attestByMatchId?.get(matchId);
        const active = matchId === selectedMatchId;
        const live = isFixtureLive(fixture) || (attest?.inPlay ?? false);
        const isAttest = isAttestMatchId(matchId);
        return (
          <Link
            key={matchId}
            href={`/match?match=${encodeURIComponent(matchId)}`}
            className={`match-fixture-chip ${active ? "active" : ""} ${live ? "match-fixture-chip--live" : ""} ${isAttest ? "match-fixture-chip--attest" : ""}`}
            role="tab"
            aria-selected={active}
            title={isAttest ? "Operator-attested settlement (TheSportsDB)" : undefined}
          >
            {live && <i className="live-dot" aria-hidden="true" />}
            {matchLabel(fixture, matchId, attestByMatchId)}
          </Link>
        );
      })}
    </div>
  );
}
