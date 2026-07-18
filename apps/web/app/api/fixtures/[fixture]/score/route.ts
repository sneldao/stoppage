import { NextResponse } from "next/server";
import { fetchScoresSnapshot, loadCredentials, type ScoreUpdate } from "@stoppage/txline";

function numericStat(stats: Record<string, number>, key: number) {
  return stats[String(key)] ?? 0;
}

export async function GET(_: Request, { params }: { params: Promise<{ fixture: string }> }) {
  const { fixture } = await params;
  const fixtureId = Number(fixture);
  if (!Number.isInteger(fixtureId) || fixtureId < 1) {
    return NextResponse.json({ error: "Invalid fixture id" }, { status: 400 });
  }

  try {
    const { network, creds } = loadCredentials();
    const updates = await fetchScoresSnapshot(network, creds, fixtureId);
    const mergedStats = [...updates]
      .sort((a, b) => a.Seq - b.Seq)
      .reduce<Record<string, number>>((stats, update: ScoreUpdate) => ({ ...stats, ...update.Stats }), {});
    const latest = updates.reduce<ScoreUpdate | null>((current, update) => !current || update.Seq > current.Seq ? update : current, null);

    return NextResponse.json({
      fixtureId,
      updatedAt: latest?.Ts ?? null,
      score: { home: numericStat(mergedStats, 1), away: numericStat(mergedStats, 2) },
      stats: {
        corners: numericStat(mergedStats, 7) + numericStat(mergedStats, 8),
        cards: numericStat(mergedStats, 3) + numericStat(mergedStats, 4) + numericStat(mergedStats, 5) + numericStat(mergedStats, 6),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Score feed unavailable" }, { status: 502 });
  }
}
