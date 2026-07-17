/**
 * useSessionKey — client-side session keypair lifecycle + on-chain
 * delegation orchestration.
 *
 * Two halves (CLAUDE.md rule 5):
 *   1. Local keypair lifecycle (create/restore/clear) — ported from pir8
 *      with the TTL-reset bug fixed (createdAt/expiresAt persisted).
 *   2. On-chain delegation + session-key signing — wired to @stoppage/sdk.
 *      delegate/revoke go through the wallet adapter (one popup each);
 *      ping goes through signWithSessionKey, which signs with the local
 *      keypair ONLY. If ping ever pops the wallet, the differentiator is
 *      decorative.
 *
 * pir8 shipped half 1 and skipped half 2. Don't repeat that.
 */

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildDelegateSessionKeyIx,
  buildRevokeSessionKeyIx,
  buildSessionPingIx,
  signWithSessionKey,
  MARKET_PROGRAM_ID,
} from "@stoppage/sdk";

const STORAGE_KEY = "stoppage_session_key";
// Match-scoped by design: a session should not outlive the day's fixtures.
// The expiry is the cool-off mechanism (rule 9) — re-delegation after
// expiry is a conscious re-commitment, not an automatic renewal.
const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

// Optional self-imposed spend cap (rule 9). The UI defaults to
// suggesting a limit (nudge, not mandate) but the user can opt out by
// passing maxTotalStake: 0. The real financial guardrail is
// fundLamports — the session key can only spend what it's been given.
const DEFAULT_MAX_STAKE_PER_MARKET = 50_000_000; // 0.05 SOL
const SUGGESTED_MAX_TOTAL_STAKE = 100_000_000; // 0.1 SOL — suggested, not forced
const DEFAULT_FUND_LAMPORTS = 100_000_000; // 0.1 SOL — covers ping fees + a few bets

export interface SessionKeyState {
  keypair: Keypair | null;
  publicKey: PublicKey | null;
  isActive: boolean;
  createdAt: number | null;
  expiresAt: number | null;
  /** Set after a successful delegate tx; null until on-chain grant exists. */
  delegated: boolean;
  /** Last ping signature — the M1 acceptance artifact. */
  lastPingSig: string | null;
}

interface StoredSession {
  secret: number[];
  createdAt: number;
  expiresAt: number;
}

const EMPTY_STATE: SessionKeyState = {
  keypair: null,
  publicKey: null,
  isActive: false,
  createdAt: null,
  expiresAt: null,
  delegated: false,
  lastPingSig: null,
};

function serialize(keypair: Keypair, createdAt: number, expiresAt: number): string {
  const stored: StoredSession = {
    secret: Array.from(keypair.secretKey),
    createdAt,
    expiresAt,
  };
  return JSON.stringify(stored);
}

function deserialize(data: string): { keypair: Keypair; createdAt: number; expiresAt: number } | null {
  try {
    const parsed = JSON.parse(data) as StoredSession;
    if (!Array.isArray(parsed.secret) || !parsed.expiresAt) return null;
    return {
      keypair: Keypair.fromSecretKey(Uint8Array.from(parsed.secret)),
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export interface DelegateOptions {
  allowedPrograms?: PublicKey[];
  maxStakePerMarket?: number;
  /** Cumulative spend cap = loss limit (rule 9). */
  maxTotalStake?: number;
  ttlSeconds?: number;
  /** Funds transferred to the session key (covers stakes + tx fees). */
  fundLamports?: number;
}

export function useSessionKey() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [state, setState] = useState<SessionKeyState>(EMPTY_STATE);

  // Restore a persisted session on mount, honoring its ORIGINAL expiry.
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const restored = deserialize(stored);
    if (restored && restored.expiresAt > Date.now()) {
      setState({
        keypair: restored.keypair,
        publicKey: restored.keypair.publicKey,
        isActive: true,
        createdAt: restored.createdAt,
        expiresAt: restored.expiresAt,
        delegated: false, // re-confirmed on next ping/delegate; not persisted
        lastPingSig: null,
      });
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const createSession = useCallback((): Keypair => {
    const keypair = Keypair.generate();
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_TIMEOUT_MS;

    sessionStorage.setItem(STORAGE_KEY, serialize(keypair, createdAt, expiresAt));
    setState({
      keypair,
      publicKey: keypair.publicKey,
      isActive: true,
      createdAt,
      expiresAt,
      delegated: false,
      lastPingSig: null,
    });
    return keypair;
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setState(EMPTY_STATE);
  }, []);

  const isSessionValid = useCallback((): boolean => {
    if (!state.isActive || !state.expiresAt) return false;
    return state.expiresAt > Date.now();
  }, [state.isActive, state.expiresAt]);

  const getSessionSigner = useCallback((): Keypair | null => {
    if (!isSessionValid()) return null;
    return state.keypair;
  }, [state.keypair, isSessionValid]);

  /**
   * One wallet popup: generate a session keypair and delegate to it
   * on-chain. After this succeeds, every later session-key action
   * (ping, and M2 join/claim) is popup-free.
   */
  const delegate = useCallback(
    async (opts: DelegateOptions = {}): Promise<string> => {
      if (!publicKey) throw new Error("Wallet not connected");
      if (!connection) throw new Error("Connection not available");

      // Pre-flight balance check — the delegate tx funds the session key
      // from the owner wallet. Give a clear error instead of the opaque
      // "Attempt to debit an account but found no record of a prior credit."
      const fundLamports = opts.fundLamports ?? DEFAULT_FUND_LAMPORTS;
      const balance = await connection.getBalance(publicKey, "confirmed");
      if (balance < fundLamports + 10_000) {
        throw new Error(
          `Insufficient SOL: need ~${(fundLamports / 1e9).toFixed(3)} SOL for the session fund + fees, but your wallet has ${(balance / 1e9).toFixed(4)} SOL. Get devnet SOL from https://faucet.solana.com/`
        );
      }

      const keypair = state.keypair ?? createSession();
      const ttlSeconds = opts.ttlSeconds ?? Math.floor(SESSION_TIMEOUT_MS / 1000);
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

      const ix = buildDelegateSessionKeyIx({
        owner: publicKey,
        sessionPubkey: keypair.publicKey,
        allowedPrograms: opts.allowedPrograms ?? [new PublicKey(MARKET_PROGRAM_ID)],
        maxStakePerMarket: opts.maxStakePerMarket ?? DEFAULT_MAX_STAKE_PER_MARKET,
        // Suggested by default; user can pass 0 to opt out (rule 9).
        maxTotalStake: opts.maxTotalStake ?? SUGGESTED_MAX_TOTAL_STAKE,
        expiresAt,
        fundLamports: opts.fundLamports ?? DEFAULT_FUND_LAMPORTS,
      });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setState((s) => ({ ...s, delegated: true }));
      return sig;
    },
    [publicKey, connection, sendTransaction, state.keypair, createSession]
  );

  /**
   * The M1 acceptance check: send a transaction signed by the session
   * key with the wallet extension closed. If this lands on chain, the
   * differentiator is real. Uses signWithSessionKey from the SDK, which
   * signs with the local keypair only — never the wallet adapter.
   */
  const ping = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected (owner needed for PDA)");
    const keypair = getSessionSigner();
    if (!keypair) throw new Error("No active session key");

    const ix = buildSessionPingIx(keypair.publicKey, publicKey);
    const sig = await signWithSessionKey(connection, keypair, [ix]);
    setState((s) => ({ ...s, lastPingSig: sig }));
    return sig;
  }, [publicKey, connection, getSessionSigner]);

  /**
   * Revoke the delegation (owner wallet signs once more) and clear the
   * local keypair. The session key's remaining fee lamports are left on
   * the keypair address — a client-side sweep back to the owner is a
   * follow-up; on devnet the amounts are trivial.
   */
  const revoke = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!state.keypair) throw new Error("No session to revoke");

    const ix = buildRevokeSessionKeyIx(publicKey, state.keypair.publicKey);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(ix);

    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    clearSession();
    return sig;
  }, [publicKey, connection, sendTransaction, state.keypair, clearSession]);

  return {
    state,
    createSession,
    clearSession,
    getSessionSigner,
    isSessionValid,
    delegate,
    ping,
    revoke,
  };
}

export default useSessionKey;
