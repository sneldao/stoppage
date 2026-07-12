/**
 * Solana Actions (Blinks) endpoint — the shareable bet-slip hook.
 *
 * GET  -> returns Action metadata (title, description, icon, and the
 *         available "side" options) so wallets/clients can render a
 *         join-market button inline (e.g. embedded in an X post).
 * POST -> given a chosen side + amount, returns an unsigned transaction
 *         for the user's wallet (or session key, if already delegated)
 *         to sign.
 *
 * TODO: wire both handlers to @stoppage/sdk's joinMarket().
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { market: string } }
) {
  // TODO: fetch real market data via @stoppage/sdk getMarket(params.market)
  return NextResponse.json({
    icon: "https://stoppage.example/icon.png",
    title: `Market ${params.market}`,
    description: "TODO: predicate description, e.g. 'Next goal within 10 min?'",
    label: "Back this",
    links: {
      actions: [
        { label: "Yes", href: `/api/actions/${params.market}?side=yes` },
        { label: "No", href: `/api/actions/${params.market}?side=no` },
      ],
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { market: string } }
) {
  const { account } = await req.json();
  const side = req.nextUrl.searchParams.get("side");

  if (!account || (side !== "yes" && side !== "no")) {
    return NextResponse.json(
      { error: "missing account or invalid side" },
      { status: 400 }
    );
  }

  // TODO: build the actual join-market transaction via @stoppage/sdk
  // and return it base64-encoded per the Solana Actions spec.
  return NextResponse.json(
    { error: "TODO: build and return unsigned transaction" },
    { status: 501 }
  );
}
