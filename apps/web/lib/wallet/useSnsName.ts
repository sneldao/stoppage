"use client";

/**
 * useSnsName — resolve a Solana wallet address to a .sol domain via SNS.
 *
 * Uses the public Solana Name Service RPC-based lookup. Falls back to
 * a truncated address if resolution fails or times out.
 *
 * No extra npm dependency: we call the SPL Name Service program directly
 * via the Solana JSON-RPC, following the deterministic naming scheme:
 * https://spl.solana.com/name-service
 *
 * For hackathon scope we use the hosted SNS reverse-lookup API from
 * sns-sdk's naming-service-app, which is a simple HTTP GET with no
 * additional package requirement.
 */

import { useEffect, useState } from "react";

/** SNS reverse-lookup — returns the first `.sol` domain for an address */
const SNS_API = "https://sns-sdk-proxy.bonfida.workers.dev/reverse-lookup/";

const cache = new Map<string, string | null>();

export function useSnsName(address: string | undefined): string {
  const [name, setName] = useState<string>(() => {
    if (!address) return "";
    if (cache.has(address)) return cache.get(address) ?? shortAddress(address);
    return shortAddress(address);
  });

  useEffect(() => {
    if (!address) return;

    // Serve from cache immediately
    if (cache.has(address)) {
      const cached = cache.get(address);
      setName(cached ?? shortAddress(address));
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3_000);

    fetch(`${SNS_API}${address}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((data: { result?: string }) => {
        if (cancelled) return;
        const resolved = data.result ? `${data.result}.sol` : null;
        cache.set(address, resolved);
        setName(resolved ?? shortAddress(address));
      })
      .catch(() => {
        if (!cancelled) {
          cache.set(address, null);
          setName(shortAddress(address));
        }
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address]);

  return name;
}

/** Truncated address fallback — 4 chars on each side */
export function shortAddress(address: string): string {
  if (!address || address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
