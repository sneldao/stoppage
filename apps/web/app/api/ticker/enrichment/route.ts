import { NextResponse } from "next/server";

/**
 * GET /api/ticker/enrichment — free external data for the global ticker.
 *
 * Fetches SOL spot price (Jupiter Price API, no key) + today's major
 * sports fixtures (TheSportsDB free tier, no key). All external calls
 * are server-side, time-boxed, and cached for 60s. Failures are silent
 * — the ticker degrades gracefully to internal rails only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOL_TIMEOUT_MS = 4000;
const SPORTS_TIMEOUT_MS = 5000;

interface EnrichmentItem {
  id: string;
  source: "sol" | "sports";
  label: string;
  ts: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchSolPrice(): Promise<EnrichmentItem | null> {
  try {
    // Jupiter Price Lite API v3 — free, no key. Uses the wrapped SOL mint
    // address (So111...11112) as the token id.
    const solMint = "So11111111111111111111111111111111111111112";
    const resp = await fetch(`https://lite-api.jup.ag/price/v3?ids=${solMint}`, {
      signal: AbortSignal.timeout(SOL_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<
      string,
      { usdPrice?: number; priceChange24h?: number } | undefined
    >;
    const price = data[solMint]?.usdPrice;
    if (price == null || !Number.isFinite(price)) return null;
    const change = data[solMint]?.priceChange24h;
    const changeStr =
      change != null && Number.isFinite(change)
        ? ` ${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}% 24h`
        : "";
    return {
      id: "sol:price",
      source: "sol",
      label: `SOL $${price.toFixed(2)}${changeStr}`,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

async function fetchSportsFixtures(): Promise<EnrichmentItem[]> {
  try {
    // TheSportsDB free tier (key "3" is the shared free key per their docs).
    // eventsday.php returns today's events across all sports.
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${dateStr}&s=Soccer`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(SPORTS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      events?: Array<{
        strEvent?: string;
        strHomeTeam?: string;
        strAwayTeam?: string;
        strTime?: string;
        strLeague?: string;
      }>;
    };
    const events = data.events;
    if (!Array.isArray(events)) return [];
    const now = Date.now();
    return events.slice(0, 6).map((e, i) => {
      const home = e.strHomeTeam ?? "?";
      const away = e.strAwayTeam ?? "?";
      const league = e.strLeague ?? "";
      return {
        id: `sports:today:${i}:${home}-${away}`,
        source: "sports" as const,
        label: `${home} vs ${away}${league ? ` · ${league}` : ""}`,
        ts: now,
      };
    });
  } catch {
    return [];
  }
}

export async function GET() {
  const [solItem, sportsItems] = await Promise.all([
    withTimeout(fetchSolPrice(), SOL_TIMEOUT_MS, null),
    withTimeout(fetchSportsFixtures(), SPORTS_TIMEOUT_MS, [] as EnrichmentItem[]),
  ]);

  const items: EnrichmentItem[] = [];
  if (solItem) items.push(solItem);
  items.push(...sportsItems);

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
