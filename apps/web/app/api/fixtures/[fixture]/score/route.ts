import { NextResponse } from "next/server";
import { fetchScoresSnapshot, loadCredentials, type ScoreUpdate } from "@stoppage/txline";

function numericStat(stats: Record<string, number>, key: number) {
  return stats[String(key)] ?? 0;
}

/**
 * Short server cache (10s in-memory + 10s CDN): the client polls every
 * 15s per live fixture, and triple-headers would otherwise 3×N clients
 * straight into TxLINE's free tier. Freshness loss is bounded —
 * scoreboards tolerate a 10s-old snapshot, and `updatedAt` stays honest.
 */
const SCORE_TTL_MS = 10_000;
const scoreCache = new Map<number, { at: number; payload: Record<string, unknown> }>();

export async function GET(_: Request, { params }: { params: Promise<{ fixture: string }> }) {
  const { fixture } = await params;
  const fixtureId = Number(fixture);
  if (!Number.isInteger(fixtureId) || fixtureId < 1) {
    return NextResponse.json({ error: "Invalid fixture id" }, { status: 400 });
  }

  try {
    const cached = scoreCache.get(fixtureId);
    if (cached && Date.now() - cached.at < SCORE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" },
      });
    }
    const { network, creds } = loadCredentials();
    const updates = await fetchScoresSnapshot(network, creds, fixtureId);
    const mergedStats = [...updates]
      .sort((a, b) => a.Seq - b.Seq)
      .reduce<Record<string, number>>((stats, update: ScoreUpdate) => ({ ...stats, ...update.Stats }), {});
    const latest = updates.reduce<ScoreUpdate | null>((current, update) => !current || update.Seq > current.Seq ? update : current, null);

    const payload = {
      fixtureId,
      updatedAt: latest?.Ts ?? null,
      score: { home: numericStat(mergedStats, 1), away: numericStat(mergedStats, 2) },
      stats: {
        corners: numericStat(mergedStats, 7) + numericStat(mergedStats, 8),
        cards: numericStat(mergedStats, 3) + numericStat(mergedStats, 4) + numericStat(mergedStats, 5) + numericStat(mergedStats, 6),
      },
    };
    scoreCache.set(fixtureId, { at: Date.now(), payload });
    if (scoreCache.size > 64) {
      const oldest = [...scoreCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest !== undefined) scoreCache.delete(oldest);
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Score feed unavailable" }, { status: 502 });
  }
}
