/**
 * Referral slice — tracks who referred the current user.
 *
 * Referral codes are passed via URL ?ref=WALLET_ADDRESS. The slice
 * captures the first ref seen (localStorage-backed) so the attribution
 * survives page reloads. The ref is appended to share links so the
 * chain continues.
 */

import type { StateCreator } from "zustand";

const STORAGE_KEY = "stoppage:ref";

export interface ReferralSlice {
  /** The wallet address that referred this user, if any. */
  referrer: string | null;
  /** Number of markets this user has shared (for streak/leaderboard). */
  sharesCount: number;
  /** Capture a ref from a URL or localStorage. Called once on app load. */
  initReferral: () => void;
  /** Record that the user shared a market. */
  recordShare: () => void;
}

function loadReferrer(): string | null {
  if (typeof window === "undefined") return null;
  // Check URL first — takes priority over stored
  const urlRef = new URLSearchParams(window.location.search).get("ref");
  if (urlRef && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(urlRef)) {
    localStorage.setItem(STORAGE_KEY, urlRef);
    return urlRef;
  }
  return localStorage.getItem(STORAGE_KEY);
}

function loadSharesCount(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem("stoppage:shares");
  return raw ? parseInt(raw, 10) || 0 : 0;
}

export const createReferralSlice: StateCreator<
  ReferralSlice,
  [],
  [],
  ReferralSlice
> = (set) => ({
  referrer: null,
  sharesCount: 0,
  initReferral: () => {
    const ref = loadReferrer();
    const count = loadSharesCount();
    set({ referrer: ref, sharesCount: count });
  },
  recordShare: () => {
    set((state) => {
      const count = state.sharesCount + 1;
      if (typeof window !== "undefined") {
        localStorage.setItem("stoppage:shares", String(count));
      }
      return { sharesCount: count };
    });
  },
});
