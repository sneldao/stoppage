/**
 * Solana Actions (Blinks) endpoint — the shareable bet-slip hook.
 *
 * GET  -> Action metadata (title, description, side options) so wallets and
 *         clients can render a join-market button inline (e.g. in an X post).
 * POST -> given a chosen side + amount, returns an unsigned join-via-wallet
 *         transaction for the user's wallet to sign. (Session-key signing is
 *         a client-side flow; Blinks use the wallet path.)
 *
 * HARD GATE: validates fixture availability before building transactions.
 * Cannot bet on markets without match data (trust violation: users staking
 * SOL on conditions they can't verify).
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
  PREDICATE_LABEL,
} from "@stoppage/sdk";
import { fetchFixtures, loadCredentials, attachReplayableFlags, matchIdFromFixture } from "@stoppage/txline";
import { validateFixtureForBettingAsync } from "@/lib/markets/fixtureValidator";
import { actionJson, ACTIONS_CORS_HEADERS, getRequestOrigin } from "@/lib/actions/cors";

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
  const challenger = req.nextUrl.searchParams.get("challenger");
  const challengerSide = req.nextUrl.searchParams.get("challengerSide");

  // Fetch real market data for the unfurl.
  let marketTitle = `Market ${market}`;
  let description = "In-play micro-market on Stoppage";
  let yesPct = "50";
  let noPct = "50";
  let poolSol = "0.00";
  
  try {
    const m = await getMarket(connection(), new PublicKey(market));
    const odds = impliedProbability(m);
    const pred = m.predicate;
    const param = pred.params.windowSeconds ?? pred.params.threshold ?? "";
    const team = pred.params.team ? ` · ${pred.params.team}` : "";
    marketTitle = `${PREDICATE_LABEL[pred.kind] ?? pred.kind} ${param}${team}`;
    yesPct = (odds.yes * 100).toFixed(0);
    noPct = (odds.no * 100).toFixed(0);
    poolSol = ((m.yesPool + m.noPool) / 1e9).toFixed(2);
    description = `YES ${yesPct}% · NO ${noPct}% · pool ${poolSol} SOL`;
  } catch {
    // Fall back to generic metadata if the market can't be fetched.
  }

  let title = marketTitle;

  if (challenger && (challengerSide === "yes" || challengerSide === "no")) {
    const challengerLabel = challenger.length > 12 ? `${challenger.slice(0, 4)}...${challenger.slice(-4)}` : challenger;
    const oppositeSide = challengerSide === "yes" ? "no" : "yes";
    
    title = `Challenge from ${challengerLabel}`;
    description = `They backed ${challengerSide.toUpperCase()} on "${marketTitle}". Bet against them! (Odds: YES ${yesPct}% · NO ${noPct}% · Pool: ${poolSol} SOL)`;
    
    return actionJson({
      icon: `${origin}/icon-512x512.png`,
      title,
      description,
      label: "Take challenge",
      links: {
        actions: [
          { label: `Bet Against Them (Back ${oppositeSide.toUpperCase()}) · 0.05 SOL`, href: `/api/actions/${market}?side=${oppositeSide}` },
          { label: `Support Them (Back ${challengerSide.toUpperCase()}) · 0.05 SOL`, href: `/api/actions/${market}?side=${challengerSide}` },
        ],
      },
    });
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

    // HARD GATE: validate fixture availability before building transaction.
    // Fetch fixtures server-side and validate the specific matchId.
    const { network, creds } = loadCredentials();
    const fixtures = await fetchFixtures(network, creds);
    const enriched = await attachReplayableFlags(network, creds, fixtures);
    const fixturesWithMatchId = enriched.map((fixture) => ({
      ...fixture,
      matchId: matchIdFromFixture(fixture),
    }));
    const validation = await validateFixtureForBettingAsync(
      fixturesWithMatchId,
      marketPk,
      async () => m
    );
    if (!validation.canBet) {
      return actionJson(
        { error: validation.reason ?? "Cannot place bet on this market" },
        { status: 400 }
      );
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
