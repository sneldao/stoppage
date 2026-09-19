/**
 * UsePod advisory — optional paid model advisory for market selection
 * (AnsemHack Inference Markets track; see docs/hackathons.md §3).
 *
 * Non-gating by design: any failure returns null and the caller falls
 * back to DEFAULT_TEMPLATES. The model can only narrow or boundedly
 * adjust the proven template set — it cannot invent predicates, move
 * settlement, or touch pricing. Deterministic rules remain the only
 * thing that can create or settle a market.
 *
 * Payment is per call via x402: quote → SOL transfer on Solana
 * mainnet → settle with the tx signature, verified on-chain by the
 * gateway (docs.usepod.ai/api/x402-payments). "The market operator
 * buys its own judgment calls on-chain, per decision, with receipts."
 *
 * Env:
 *   USEPOD_ADVISORY=1            — enable (default off)
 *   USEPOD_MODEL                 — model name (default gpt-4o-mini)
 *   USEPOD_PAYMENT_RPC           — mainnet RPC for the payment tx
 *                                  (default api.mainnet-beta.solana.com)
 *   USEPOD_MAX_PAYMENT_LAMPORTS  — refuse quotes above this ceiling
 *                                  (default 100_000 ≈ a cent or two)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import type { MatchTemplates } from "./strategy";
import { logger } from "./telemetry";

const X402_CHAT_URL = "https://api.usepod.ai/proxy/x402/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_PAYMENT_LAMPORTS = 100_000;
const FETCH_TIMEOUT_MS = 15_000;

// The model may adjust lines only inside these bounds.
const GOALS_LINE_RANGE = { min: 1, max: 6 };
const CORNERS_LINE_RANGE = { min: 5, max: 15 };

export function usepodAdvisoryEnabled(): boolean {
  const v = process.env.USEPOD_ADVISORY?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface AdvisoryResult {
  templates: MatchTemplates;
  /** One-line ledger summary of what the model chose and why. */
  note: string;
}

interface X402Accept {
  asset: string;
  network: string;
  pay_to: string;
  amount_microunits: number;
}

interface X402Quote {
  quote_id: string;
  accepts: X402Accept[];
}

function paymentConnection(): Connection {
  return new Connection(
    process.env.USEPOD_PAYMENT_RPC ?? clusterApiUrl("mainnet-beta"),
    "confirmed"
  );
}

async function sendSolPayment(
  wallet: Keypair,
  payTo: string,
  lamports: number
): Promise<string> {
  const connection = paymentConnection();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(payTo),
      lamports,
    })
  );
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(wallet);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

/**
 * One x402 round-trip: request → 402 quote → on-chain SOL payment →
 * identical request + PAYMENT-SIGNATURE → completion. Returns the
 * model's text content and the payment signature (for the ledger).
 */
async function x402ChatCompletion(
  bodyJson: string,
  wallet: Keypair
): Promise<{ content: string; paymentSignature?: string }> {
  const headers = { "Content-Type": "application/json" };
  const quoteRes = await fetch(X402_CHAT_URL, {
    method: "POST",
    headers,
    body: bodyJson,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // 200 means a prior overpayment credit covered the call — no payment.
  if (quoteRes.ok) {
    const json = (await quoteRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { content: json.choices?.[0]?.message?.content ?? "" };
  }
  if (quoteRes.status !== 402) {
    throw new Error(`UsePod quote failed: HTTP ${quoteRes.status}`);
  }

  const encodedQuote = quoteRes.headers.get("payment-required");
  if (!encodedQuote) throw new Error("402 without PAYMENT-REQUIRED header");
  const quote = JSON.parse(
    Buffer.from(encodedQuote, "base64").toString("utf8")
  ) as X402Quote;

  const sol = quote.accepts.find((a) => a.asset === "SOL");
  if (!sol) throw new Error("quote offers no SOL rail");
  const cap = Number(process.env.USEPOD_MAX_PAYMENT_LAMPORTS ?? DEFAULT_MAX_PAYMENT_LAMPORTS);
  if (sol.amount_microunits > cap) {
    throw new Error(`quote ${sol.amount_microunits} lamports exceeds cap ${cap}`);
  }

  const balance = await paymentConnection().getBalance(wallet.publicKey);
  if (balance < sol.amount_microunits + 10_000) {
    throw new Error(`keeper wallet lacks mainnet SOL for payment (${balance} < ${sol.amount_microunits})`);
  }

  const paymentSignature = await sendSolPayment(wallet, sol.pay_to, sol.amount_microunits);

  const paymentHeader = Buffer.from(
    JSON.stringify({
      quote_id: quote.quote_id,
      network: sol.network,
      asset: "SOL",
      payer_wallet: wallet.publicKey.toBase58(),
      signature: paymentSignature,
    })
  ).toString("base64");

  // Step 3 must send a byte-identical body — reuse bodyJson verbatim.
  const res = await fetch(X402_CHAT_URL, {
    method: "POST",
    headers: { ...headers, "PAYMENT-SIGNATURE": paymentHeader },
    body: bodyJson,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`UsePod settle failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return {
    content: json.choices?.[0]?.message?.content ?? "",
    paymentSignature,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse the model's JSON reply into bounded templates. Throws on bad shape. */
function parseAdvisory(content: string, model: string, paymentSignature?: string): AdvisoryResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("advisory reply contained no JSON");
  const parsed = JSON.parse(match[0]);

  const goals = parsed?.goals ?? {};
  const corners = parsed?.corners ?? {};
  const templates: MatchTemplates = {
    totalGoalsOver: goals.enabled === false
      ? null
      : clampInt(goals.threshold, GOALS_LINE_RANGE.min, GOALS_LINE_RANGE.max, 3),
    cornersOver: corners.enabled === false
      ? null
      : clampInt(corners.threshold, CORNERS_LINE_RANGE.min, CORNERS_LINE_RANGE.max, 9),
  };

  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 140) : "";
  const paid = paymentSignature ? ` · x402 ${paymentSignature.slice(0, 8)}…` : "";
  const describe = (line: number | null, kind: string) => (line === null ? `${kind} off` : `${kind} over ${line}`);
  return {
    templates,
    note: `UsePod advisory (${model}${paid}): ${describe(templates.totalGoalsOver, "goals")}, ${describe(templates.cornersOver, "corners")}${reason ? ` — ${reason}` : ""}`,
  };
}

/**
 * Ask the model which proven templates to run for this fixture.
 * Advisory only: returns null on any failure, and the result can only
 * express the bounded template set — never arbitrary predicates.
 */
export async function adviseTemplates(args: {
  wallet: Keypair;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}): Promise<AdvisoryResult | null> {
  const model = process.env.USEPOD_MODEL ?? DEFAULT_MODEL;
  try {
    const bodyJson = JSON.stringify({
      model,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You advise Matchkeeper, an autonomous sports-prediction-market operator on Solana, " +
            "on which over/under markets to open at kickoff. Reply with strict JSON only, no prose.",
        },
        {
          role: "user",
          content:
            `Fixture ${args.matchId}: ${args.homeTeam || "home"} vs ${args.awayTeam || "away"}.\n` +
            `Available proven templates (TxLINE proof-verifiable stats only):\n` +
            `- total_goals_over: threshold ${GOALS_LINE_RANGE.min}–${GOALS_LINE_RANGE.max}, default 3\n` +
            `- corners_over: threshold ${CORNERS_LINE_RANGE.min}–${CORNERS_LINE_RANGE.max}, default 9\n` +
            `Choose which to open and the line. ` +
            `JSON: {"goals":{"enabled":bool,"threshold":int},"corners":{"enabled":bool,"threshold":int},"reason":"<=140 chars"}`,
        },
      ],
    });
    const { content, paymentSignature } = await x402ChatCompletion(bodyJson, args.wallet);
    return parseAdvisory(content, model, paymentSignature);
  } catch (err) {
    logger.warn("UsePod advisory failed; falling back to default templates", {
      matchId: args.matchId,
      error: String(err),
    });
    return null;
  }
}
