"use client";

import { useEffect } from "react";
import { useStoppageStore } from "@/store";

/**
 * Initializes client-side store slices on app load.
 *
 * - Referral: reads ?ref=WALLET from the URL, persists to localStorage.
 * - History: loads settled position history from localStorage.
 *
 * Renders nothing.
 */
export function ReferralInit() {
  const initReferral = useStoppageStore((s) => s.initReferral);
  const initHistory = useStoppageStore((s) => s.initHistory);
  const initActivity = useStoppageStore((s) => s.initActivity);
  useEffect(() => {
    initReferral();
    initHistory();
    initActivity();
  }, [initReferral, initHistory, initActivity]);
  return null;
}
