/**
 * Solana Actions (Blinks) endpoint — the shareable bet-slip hook.
 *
 * GET  -> Action metadata (title, description, side options) so wallets and
 *         clients can render a join-market button inline (e.g. in an X post).
 * POST -> given a chosen side + amount, returns an unsigned transaction for
 *         the user's wallet (or session key, if already delegated) to sign.
 *
 * TODO: wire both handlers to @stoppage/sdk's joinMarket() once the market
 * program's join instruction exists.
 */

import { NextRequest } from "next/server";
import { actionJson, ACTIONS_CORS_HEADERS, getRequestOrigin } from "@/lib/actions/cors";

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const { market } = await params;
  const origin = getRequestOrigin(req);

  // TODO: fetch real market data via @stoppage/sdk getMarket(market)
  return actionJson({
    icon: `${origin}/icon-512x512.png`,
    title: `Market ${market}`,
    description: "TODO: predicate description, e.g. 'Next goal within 10 min?'",
    label: "Back this",
    links: {
      actions: [
        { label: "Yes", href: `/api/actions/${market}?side=yes` },
        { label: "No", href: `/api/actions/${market}?side=no` },
      ],
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const { market } = await params;
  const { account } = await req.json();
  const side = req.nextUrl.searchParams.get("side");

  if (!account || (side !== "yes" && side !== "no")) {
    return actionJson(
      { error: "missing account or invalid side" },
      { status: 400 }
    );
  }

  // TODO: build the join-market transaction via @stoppage/sdk for `market`
  // and return it base64-encoded per the Solana Actions spec.
  return actionJson(
    { error: "TODO: build and return unsigned transaction" },
    { status: 501 }
  );
}
