/**
 * Bet error classification — turns raw wallet/RPC/program failures into
 * honest, actionable copy for the bet slip.
 *
 * One implementation (rule 6): the market detail page renders whatever
 * classifyBetError returns; no ad-hoc error string parsing in components.
 *
 * Honesty rules carried through from CLAUDE.md:
 * - Wallet rejection: nothing was submitted, say so.
 * - Rule 9 caps: enforced limits are a feature, not a bug — no "bypass"
 *   affordance, just the deliberate path (end session, re-delegate).
 * - Session expiry: the fallback is the wallet signature, which the
 *   page already supports (getSessionSigner() returns null → wallet path).
 */

export type BetErrorAction =
  /** Re-run the same submit (transient network failure, wallet rejection). */
  | "retry"
  /** Session path failed on-chain — re-submit with a wallet signature instead. */
  | "retry-wallet"
  /** Market state likely changed — refetch it. */
  | "refresh"
  /** No useful recovery (cap hit, no funds, bet blocked by the proof gate). */
  | "none";

export interface BetErrorInfo {
  /** Short title: what happened. */
  title: string;
  /** One or two sentences: what it means and what to do. */
  hint: string;
  action: BetErrorAction;
  /** The raw error message, kept for details/aria (never silently swallowed). */
  raw: string;
}

/** Build a BetErrorInfo from a plain validation message (no classification). */
export function simpleBetError(message: string, action: BetErrorAction = "none"): BetErrorInfo {
  return { title: "Can't place this bet yet", hint: message, action, raw: message };
}

function msg(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

interface Rule {
  test: RegExp;
  info: (message: string, ctx: BetErrorContext) => Omit<BetErrorInfo, "raw">;
}

export interface BetErrorContext {
  /** True when the failed attempt was signed by the session key. */
  viaSession: boolean;
}

const INSUFFICIENT_FUNDS = /insufficient|debit an account|not enough lamports|lamports.*(short|deficit)/i;
const NETWORK =
  /failed to fetch|fetch failed|network|econnreset|429|too many requests|blockhash|block hash|expired before|was not confirmed|timeout/i;
const WALLET_REJECTED = /reject|denied|cancel|user (did not|refused)|disconnected/i;

const RULES: Rule[] = [
  // ── On-chain grant failures (Anchor program logs surface these strings) ──
  {
    test: /session grant has expired|grant.*expired/i,
    info: () => ({
      title: "Your one-tap session ended",
      hint: "The on-chain grant expired (the 6h cool-off did its job). This bet can still go through — it just needs your wallet's approval once.",
      action: "retry-wallet",
    }),
  },
  {
    test: /session grant has been revoked/i,
    info: () => ({
      title: "Your one-tap session was revoked",
      hint: "You ended this session on-chain, so the session key can no longer sign. Place this bet with your wallet, or enable one-tap again when you're ready.",
      action: "retry-wallet",
    }),
  },
  {
    test: /cumulative spend cap exceeded/i,
    info: () => ({
      title: "You've reached your session spend cap",
      hint: "This is the self-imposed limit you chose when enabling one-tap, enforced on-chain. To keep betting, end the session and re-delegate with a new limit — a deliberate re-commitment, not an accident.",
      action: "none",
    }),
  },
  {
    test: /per-market stake cap exceeded/i,
    info: () => ({
      title: "Stake is above your per-market cap",
      hint: "Your session grant caps a single market at 0.05 SOL. Lower the stake to place this bet one-tap.",
      action: "none",
    }),
  },
  {
    test: /not in the session grant'?s allowlist/i,
    info: () => ({
      title: "This market's program isn't in your session grant",
      hint: "The one-tap grant only authorizes specific programs. Place this bet with your wallet instead.",
      action: "retry-wallet",
    }),
  },
  {
    test: /already joined the opposite side/i,
    info: () => ({
      title: "You're on the other side of this market",
      hint: "A wallet can only hold one side of a market. Your existing position stays open; pick the other outcome on a different market, or wait for this one to settle.",
      action: "refresh",
    }),
  },
  {
    test: /market has closed/i,
    info: () => ({
      title: "This market closed while you were deciding",
      hint: "No new positions can open. Refresh to see the current state — settlement is proof-gated and your existing positions are unaffected.",
      action: "refresh",
    }),
  },
  {
    test: /market is not open/i,
    info: () => ({
      title: "This market isn't open",
      hint: "Its state changed (settling, resolved, or voided). Refresh to see where it stands.",
      action: "refresh",
    }),
  },
  {
    test: /nothing to claim/i,
    info: () => ({
      title: "Nothing left to claim",
      hint: "This position was already claimed or paid out. Refresh to see the current balance.",
      action: "refresh",
    }),
  },
  // ── Client-side proof gate (fixtureValidator) — bets we refuse to take ──
  {
    test: /awaiting match data|market data still loading|match ended|betting opens 2h before kickoff/i,
    info: (message) => ({
      title: "Bet blocked by the proof path",
      hint: `Stoppage doesn't take stakes it can't verify: ${message.toLowerCase()}. This gate protects you — betting reopens automatically once the proof path is confirmed.`,
      action: "none",
    }),
  },
  // ── Wallet-side failures ──
  {
    test: WALLET_REJECTED,
    info: () => ({
      title: "Nothing was submitted",
      hint: "The wallet request was rejected or cancelled. No transaction went out and no funds moved. Approve the request in your wallet to place this bet.",
      action: "retry",
    }),
  },
  // ── Funds ──
  {
    test: INSUFFICIENT_FUNDS,
    info: (_m, ctx) => ({
      title: ctx.viaSession ? "Session fund is running low" : "Not enough SOL",
      hint: ctx.viaSession
        ? "The 0.1 SOL session fund covers stakes + fees and can't pay for this bet. Use your wallet for this one (the session fund stays where it is)."
        : "Your wallet doesn't hold enough SOL for this stake plus fees. On devnet, top up from https://faucet.solana.com/ and try again.",
      action: ctx.viaSession ? "retry-wallet" : "none",
    }),
  },
  // ── Network / timing ──
  {
    test: NETWORK,
    info: () => ({
      title: "The network didn't land the transaction",
      hint: "It likely expired or timed out before confirming — no funds moved. Check the previous signature in your wallet if you retried quickly, then try again.",
      action: "retry",
    }),
  },
];

/**
 * Classify a failed join/claim attempt into actionable copy.
 * Order matters: program errors first (most specific), then wallet
 * rejection, funds, network — the generic retry fallback is last.
 */
export function classifyBetError(cause: unknown, ctx: BetErrorContext): BetErrorInfo {
  const message = msg(cause);
  for (const rule of RULES) {
    if (rule.test.test(message)) {
      return { ...rule.info(message, ctx), raw: message };
    }
  }
  return {
    title: "This bet didn't go through",
    hint: "Something failed that we haven't seen before. It's safe to try again — if the previous attempt had landed, it would show up in your positions.",
    action: "retry",
    raw: message,
  };
}
