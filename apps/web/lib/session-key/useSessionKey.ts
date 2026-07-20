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
  findSessionGrantPda,
  readU64LE,
  readI64LE,
  MARKET_PROGRAM_ID,
} from "@stoppage/sdk";

// localStorage so one-tap betting survives new tabs (sessionStorage silently
// reverted users to wallet popups — the differentiator died invisibly).
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
  /** True once an on-chain grant is confirmed (delegate tx, or a resumed
   *  grant found on-chain for the restored keypair). */
  delegated: boolean;
  /** True while we check the chain for a grant matching the restored key. */
  restoring: boolean;
  /** Local keypair removed but the on-chain grant still exists — one
   *  wallet signature (a fresh delegate tx) re-activates without losing
   *  the old grant's history. "Pause" never revokes on-chain. */
  paused: boolean;
  /** Wallet that owns the on-chain grant for this keypair. */
  owner: string | null;
  /** Last ping signature — the M1 acceptance artifact. */
  lastPingSig: string | null;
}

interface StoredSession {
  secret: number[];
  createdAt: number;
  expiresAt: number;
  /** Wallet that delegated this session — grants are per (owner, key). */
  owner?: string;
  paused?: boolean;
}

const EMPTY_STATE: SessionKeyState = {
  keypair: null,
  publicKey: null,
  isActive: false,
  createdAt: null,
  expiresAt: null,
  delegated: false,
  restoring: false,
  paused: false,
  owner: null,
  lastPingSig: null,
};

function serialize(
  keypair: Keypair,
  createdAt: number,
  expiresAt: number,
  owner?: string,
  paused = false
): string {
  const stored: StoredSession = {
    secret: Array.from(keypair.secretKey),
    createdAt,
    expiresAt,
    owner,
    paused,
  };
  return JSON.stringify(stored);
}

function deserialize(
  data: string
): { keypair: Keypair; createdAt: number; expiresAt: number; owner?: string; paused?: boolean } | null {
  try {
    const parsed = JSON.parse(data) as StoredSession;
    if (!Array.isArray(parsed.secret) || !parsed.expiresAt) return null;
    return {
      keypair: Keypair.fromSecretKey(Uint8Array.from(parsed.secret)),
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      owner: parsed.owner,
      paused: parsed.paused,
    };
  } catch {
    return null;
  }
}

/**
 * Read the on-chain SessionGrant for (owner, sessionPubkey).
 * Returns expiry (seconds) if the grant exists and is not revoked.
 * Layout after the 8-byte discriminator:
 *   owner(32) | sessionPubkey(32) | vec<pubkey> allowed_programs |
 *   u64 max_stake_per_market | u64 max_total_stake | u64 staked_so_far |
 *   i64 expires_at | bool revoked
 */
async function fetchLiveGrant(
  connection: ReturnType<typeof useConnection>["connection"],
  owner: PublicKey,
  sessionPubkey: PublicKey
): Promise<{ expiresAtSec: number } | null> {
  try {
    const [grant] = findSessionGrantPda(owner, sessionPubkey);
    const info = await connection.getAccountInfo(grant, "confirmed");
    if (!info?.data || info.data.length < 8 + 32 + 32 + 4) return null;
    let offset = 8 + 32 + 32;
    const vecLen = info.data.readUInt32LE(offset);
    offset += 4 + vecLen * 32 + 8 + 8 + 8;
    const expiresAtSec = Number(readI64LE(info.data, offset));
    offset += 8;
    const revoked = info.data.readUInt8(offset) !== 0;
    if (revoked) return null;
    return { expiresAtSec };
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
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const restored = deserialize(stored);
    if (restored && restored.expiresAt > Date.now()) {
      setState({
        keypair: restored.keypair,
        publicKey: restored.keypair.publicKey,
        isActive: !restored.paused,
        createdAt: restored.createdAt,
        expiresAt: restored.expiresAt,
        delegated: false,
        restoring: !restored.paused,
        paused: Boolean(restored.paused),
        owner: restored.owner ?? null,
        lastPingSig: null,
      });
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Once the wallet is connected, check the chain for a live grant matching
  // the restored keypair. This is what makes one-tap resume in a new tab
  // with NO popup — before this, `delegated` reset to false on every load
  // and users silently fell back to wallet approval.
  useEffect(() => {
    if (!state.keypair || !publicKey) return;
    if (state.delegated || state.paused) return;
    if (state.owner && state.owner !== publicKey.toBase58()) return;
    let cancelled = false;
    void fetchLiveGrant(connection, publicKey, state.keypair.publicKey).then((grant) => {
      if (cancelled) return;
      if (grant && grant.expiresAtSec * 1000 > Date.now()) {
        setState((s) => ({ ...s, delegated: true, restoring: false, expiresAt: grant.expiresAtSec * 1000 }));
      } else {
        // Grant missing/revoked/expired on-chain — drop the local key so the
        // UI doesn't promise one-tap that will fail at signing time.
        if (grant) {
          // Expired naturally: keep the key (re-delegation is a conscious
          // re-commitment per rule 9) but don't claim it's live.
          setState((s) => ({ ...s, restoring: false }));
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setState(EMPTY_STATE);
        }
      }
    });
    return () => { cancelled = true; };
  }, [connection, publicKey, state.keypair, state.delegated, state.paused, state.owner]);

  const createSession = useCallback((): Keypair => {
    const keypair = Keypair.generate();
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_TIMEOUT_MS;

    localStorage.setItem(STORAGE_KEY, serialize(keypair, createdAt, expiresAt, publicKey?.toBase58()));
    setState({
      keypair,
      publicKey: keypair.publicKey,
      isActive: true,
      createdAt,
      expiresAt,
      delegated: false,
      restoring: false,
      paused: false,
      owner: publicKey?.toBase58() ?? null,
      lastPingSig: null,
    });
    return keypair;
  }, [publicKey]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(EMPTY_STATE);
  }, []);

  const isSessionValid = useCallback((): boolean => {
    if (!state.isActive || !state.expiresAt) return false;
    return state.expiresAt > Date.now();
  }, [state.isActive, state.expiresAt]);

  const getSessionSigner = useCallback((): Keypair | null => {
    if (!isSessionValid() || !state.delegated) return null;
    return state.keypair;
  }, [state.keypair, state.delegated, isSessionValid]);

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
      localStorage.setItem(
        STORAGE_KEY,
        serialize(keypair, state.createdAt ?? Date.now(), expiresAt * 1000, publicKey.toBase58())
      );
      setState((s) => ({ ...s, delegated: true, restoring: false, paused: false, isActive: true, expiresAt: expiresAt * 1000, owner: publicKey.toBase58() }));
      return sig;
    },
    [publicKey, connection, sendTransaction, state.keypair, state.createdAt, createSession]
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
   * Revoke the delegation on-chain (owner wallet signs once more) and clear
   * the local keypair. This is the self-exclude path (rule 9) — deliberate
   * and destructive. For a temporary opt-out use pause() instead.
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

  /**
   * Pause one-tap betting WITHOUT an on-chain revoke: keep the keypair
   * persisted (so revoke can still build the revoke ix later) but flip
   * `isActive: false` so `getSessionSigner()` returns null and one-tap
   * is effectively off. No wallet popup. The user can resume later with
   * one wallet signature (a fresh delegate tx) or fully exit via
   * `revoke()` to reclaim the session fund + rent.
   *
   * Earlier versions dropped the local keypair on pause, which orphaned
   * the on-chain grant — `revoke()` needs `state.keypair.publicKey` to
   * build the ix, so a paused user couldn't reclaim their 0.1 SOL fund
   * until the 6h expiry. Keeping the key locally is safe: the on-chain
   * grant is the real security boundary, and `getSessionSigner` is
   * disabled while paused.
   */
  const pause = useCallback(() => {
    setState((s) => {
      if (!s.keypair) return s;
      // Re-serialize with paused: true so the reload path also keeps
      // the keypair and can revoke.
      localStorage.setItem(
        STORAGE_KEY,
        serialize(s.keypair, s.createdAt ?? Date.now(), s.expiresAt ?? Date.now(), s.owner ?? undefined, true)
      );
      return {
        ...s,
        isActive: false,
        delegated: false,
        paused: true,
        restoring: false,
      };
    });
  }, []);

  /**
   * Resume a paused session: generate a fresh keypair and delegate to it
   * on-chain (one wallet popup). This is a fresh delegation — a new
   * keypair, a new 6h expiry, and a new fund transfer — not a pickup of
   * the old grant. The previous on-chain grant (if still live) is left
   * in place; only `revoke` reclaims its rent + fund.
   */
  const resume = useCallback(async (): Promise<string> => {
    return delegate();
  }, [delegate]);

  return {
    state,
    createSession,
    clearSession,
    getSessionSigner,
    isSessionValid,
    delegate,
    ping,
    revoke,
    pause,
    resume,
  };
}

export default useSessionKey;
