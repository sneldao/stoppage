/**
 * useSessionKey — client-side session keypair lifecycle.
 *
 * Ported from pir8 src/hooks/useSessionKey.ts with two deliberate changes:
 *
 * 1. BUG FIX: the original recomputed createdAt = Date.now() on every mount,
 *    so a restored session's expiry clock reset forever and TTL was never
 *    enforced. Here createdAt/expiresAt are persisted alongside the key.
 *
 * 2. This hook only manages the LOCAL keypair. It is half of the feature.
 *    The other half — the on-chain delegation grant and actually signing
 *    market instructions with this key (never wallet.signTransaction) —
 *    lives in @stoppage/sdk sessionKey.ts. In pir8 that half was never
 *    wired, which made the session key decorative. Don't repeat that.
 */

import { useState, useEffect, useCallback } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";

const STORAGE_KEY = "stoppage_session_key";
// Match-scoped by design: a session should not outlive the day's fixtures.
const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface SessionKeyState {
  keypair: Keypair | null;
  publicKey: PublicKey | null;
  isActive: boolean;
  createdAt: number | null;
  expiresAt: number | null;
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

export function useSessionKey() {
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

  return { state, createSession, clearSession, getSessionSigner, isSessionValid };
}

export default useSessionKey;
