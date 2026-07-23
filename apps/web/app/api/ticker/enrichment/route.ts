import { NextResponse } from "next/server";

/**
 * GET /api/ticker/enrichment — free external data for the global ticker.
 *
 * Fetches SOL spot price (Jupiter Price API, no key), today's major
 * sports fixtures (TheSportsDB free tier, no key), and "On this day"
 * sports history (Wikipedia REST API, no key). All external calls are
 * server-side, time-boxed, and cached. Failures are silent — the
 * ticker degrades gracefully to internal rails only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOL_TIMEOUT_MS = 4000;
const SPORTS_TIMEOUT_MS = 5000;
const WIKI_TIMEOUT_MS = 5000;

interface EnrichmentItem {
  id: string;
  source: "sol" | "sports" | "fact";
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

/**
 * Strict sports keyword patterns for filtering Wikipedia "On this day"
 * events. Uses compound/unambiguous terms to avoid false positives on
 * non-sports historical events. Avoids words like "shooting", "polo",
 * "archery", "race" that match non-sports contexts.
 */
const SPORTS_PATTERNS: ReadonlyArray<RegExp> = [
  /\bworld cup\b/i, /\bolympic/i, /\bchampionship\b/i, /\bgrand slam\b/i,
  /\bworld series\b/i, /\bsuper bowl\b/i, /\bnba\b/i, /\bnfl\b/i, /\bmlb\b/i,
  /\bnhl\b/i, /\bpremier league\b/i, /\bla liga\b/i, /\bserie a\b/i,
  /\bbundesliga\b/i, /\bligue 1\b/i, /\bchampions league\b/i, /\beuropa league\b/i,
  /\buefa\b/i, /\bfifa\b/i, /\bwimbledon\b/i, /\bus open\b/i, /\bfrench open\b/i,
  /\baustralian open\b/i, /\bgold medal\b/i, /\bsilver medal\b/i, /\bbronze medal\b/i,
  /\bhall of fame\b/i, /\bworld record\b/i, /\bworld champion\b/i,
  /\bfootball\b/i, /\bsoccer\b/i, /\bbaseball\b/i, /\bbasketball\b/i,
  /\bhockey\b/i, /\btennis\b/i, /\bboxing\b/i, /\bcricket\b/i, /\brugby\b/i,
  /\bgolf\b/i, /\bcycling\b/i, /\bswimming\b/i, /\bmarathon\b/i, /\bchess\b/i,
  /\bformula 1\b/i, /\bf1\b/i, /\bnascar\b/i, /\brally\b/i,
  /\bskiing\b/i, /\bskating\b/i, /\bjudo\b/i, /\bkarate\b/i, /\btaekwondo\b/i,
  /\bwrestling\b/i, /\bgymnastics\b/i, /\browing\b/i, /\bsailing\b/i, /\bclimbing\b/i,
  /\bsnooker\b/i, /\bdarts\b/i, /\btable tennis\b/i, /\bbadminton\b/i,
  /\bvolleyball\b/i, /\bhandball\b/i, /\bnetball\b/i,
  /\btour de france\b/i, /\bgiro d.italia\b/i, /\bvuelta\b/i,
  /\bstanley cup\b/i, /\bworld heavyweight\b/i, /\bwelterweight\b/i,
  /\bmiddleweight\b/i, /\blightweight\b/i, /\bheavyweight\b/i,
  /\btest match\b/i, /\btest cricket\b/i, /\bone day international\b/i,
  /\bt20\b/i, /\bipl\b/i, /\bashes\b/i,
  /\bcopa am/i, /\bafrican cup\b/i, /\bafcon\b/i,
  /\bpenalty shootout\b/i, /\bown goal\b/i, /\bhat.trick\b/i, /\bextra time\b/i,
];

async function fetchOnThisDay(): Promise<EnrichmentItem[]> {
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      events?: Array<{ year?: number; text?: string }>;
    };
    const events = data.events;
    if (!Array.isArray(events)) return [];
    // Filter to sports events using strict patterns, take most recent 3.
    const sports = events
      .filter((e) => typeof e.text === "string" && SPORTS_PATTERNS.some((p) => p.test(e.text!)))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      .slice(0, 3);
    const ts = Date.now();
    return sports.map((e, i) => ({
      id: `fact:onthisday:${i}:${e.year ?? "?"}`,
      source: "fact" as const,
      label: `${e.year ?? "?"}: ${e.text!.slice(0, 120)}`,
      ts,
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const [solItem, sportsItems, factItems] = await Promise.all([
    withTimeout(fetchSolPrice(), SOL_TIMEOUT_MS, null),
    withTimeout(fetchSportsFixtures(), SPORTS_TIMEOUT_MS, [] as EnrichmentItem[]),
    withTimeout(fetchOnThisDay(), WIKI_TIMEOUT_MS, [] as EnrichmentItem[]),
  ]);

  const items: EnrichmentItem[] = [];
  if (solItem) items.push(solItem);
  items.push(...sportsItems);
  items.push(...factItems);

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
