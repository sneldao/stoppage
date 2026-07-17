/**
 * Solana Actions (Blinks) endpoint — the shareable bet-slip hook.
 *
 * GET  -> Action metadata (title, description, side options) so wallets and
 *         clients can render a join-market button inline (e.g. in an X post).
 * POST -> given a chosen side + amount, returns an unsigned join-via-wallet
 *         transaction for the user's wallet to sign. (Session-key signing is
 *         a client-side flow; Blinks use the wallet path.)
 */

import { NextRequest } from "next/server";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  buildJoinViaWalletIx,
  getMarket,
  impliedProbability,
} from "@stoppage/sdk";
import { actionJson, ACTIONS_CORS_HEADERS, getRequestOrigin } from "@/lib/actions/cors";

const PREDICATE_LABEL: Record<string, string> = {
  next_goal_within: "Next goal within",
  corners_over: "Corners over",
  card_shown: "Card shown",
  total_goals_over: "Total goals over",
};

// Default stake for a Blink join (0.05 SOL). The Actions spec allows a
// parameterized amount via linked actions; for the demo a fixed default
// keeps the slip one-tap.
const DEFAULT_AMOUNT_LAMPORTS = 50_000_000;

function connection() {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  return new Connection(url && !url.includes("YOUR_API_KEY") ? url : clusterApiUrl("devnet"), "confirmed");
}

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_CORS_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const { market } = await params;
  const origin = getRequestOrigin(req);

  // Fetch real market data for the unfurl.
  let title = `Market ${market}`;
  let description = "In-play micro-market on Stoppage";
  try {
    const m = await getMarket(connection(), new PublicKey(market));
    const odds = impliedProbability(m);
    const pred = m.predicate;
    const param = pred.params.windowSeconds ?? pred.params.threshold ?? "";
    const team = pred.params.team ? ` · ${pred.params.team}` : "";
    title = `${PREDICATE_LABEL[pred.kind] ?? pred.kind} ${param}${team}`;
    description = `YES ${(odds.yes * 100).toFixed(0)}% · NO ${(odds.no * 100).toFixed(0)}% · pool ${(m.yesPool + m.noPool) / 1e9} SOL`;
  } catch {
    // Fall back to generic metadata if the market can't be fetched.
  }

  return actionJson({
    icon: `${origin}/icon-512x512.png`,
    title,
    description,
    label: "Back this",
    links: {
      actions: [
        { label: "Back YES · 0.05 SOL", href: `/api/actions/${market}?side=yes` },
        { label: "Back NO · 0.05 SOL", href: `/api/actions/${market}?side=no` },
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

  try {
    const conn = connection();
    const marketPk = new PublicKey(market);
    const accountPk = new PublicKey(account);

    // Verify the market exists and is open before building the tx.
    const m = await getMarket(conn, marketPk);
    if (m.status !== "open") {
      return actionJson({ error: `market is ${m.status}` }, { status: 400 });
    }

    const ix = buildJoinViaWalletIx(accountPk, marketPk, side, DEFAULT_AMOUNT_LAMPORTS);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: accountPk,
      blockhash,
      lastValidBlockHeight,
    }).add(ix);
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    return actionJson({
      transaction: serialized.toString("base64"),
      message: `Back ${side.toUpperCase()} with 0.05 SOL`,
    });
  } catch (e) {
    return actionJson(
      { error: e instanceof Error ? e.message : "failed to build transaction" },
      { status: 500 }
    );
  }
}
