"use client";

import { useEffect } from "react";
import { useStoppageStore } from "@/store";

/**
 * Initializes the referral slice on app load.
 *
 * Reads ?ref=WALLET from the URL (if present) and persists it to
 * localStorage so attribution survives navigation. Renders nothing.
 */
export function ReferralInit() {
  const initReferral = useStoppageStore((s) => s.initReferral);
  useEffect(() => {
    initReferral();
  }, [initReferral]);
  return null;
}
