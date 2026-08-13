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
    return `${fixture.Participant1} v ${fixture.Participant2}`;
  }
  const attest = attestByMatchId?.get(matchId);
  if (attest) {
    // Same fixture can also exist on the TxLINE plane — the suffix is what
    // keeps the two chips from reading as a duplicate.
    return `${attest.homeTeam} v ${attest.awayTeam} · attested`;
  }
  return matchId;
}

/**
 * Chip row for the match room. Only matches with real context (a TxLINE
 * fixture or an operator-attested event) get a chip — raw feed/market ids
 * (price_above markets, custom /launch markets) used to render one chip
 * each and drowned the room. They collapse into a single summary link to
 * the markets page instead.
 */
export function MatchFixturePicker({ fixtures, matchIds, selectedMatchId, attestByMatchId }: MatchFixturePickerProps) {
  const contextMatchIds = matchIds.filter(
    (matchId) => fixtures.some((item) => item.matchId === matchId) || attestByMatchId?.has(matchId)
  );
  const otherCount = matchIds.length - contextMatchIds.length;

  if (contextMatchIds.length <= 1 && otherCount === 0) return null;

  return (
    <div className="match-fixture-picker" role="tablist" aria-label="Choose match">
      {contextMatchIds.map((matchId) => {
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
      {otherCount > 0 && (
        <Link href="/markets" className="match-fixture-chip match-fixture-chip--other" title="Price-feed and custom markets live on the markets page">
          {otherCount} price-feed {otherCount === 1 ? "market" : "markets"} →
        </Link>
      )}
    </div>
  );
}
