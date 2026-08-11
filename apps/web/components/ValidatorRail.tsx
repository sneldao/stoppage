"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  DEFAULT_ORACLE,
  PYTH_VALIDATOR_PROGRAM_ID,
} from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import { oracleInfoFor } from "@/lib/oracle";

/**
 * ValidatorRail — the enumerable "one contract, many oracles" exhibit.
 *
 * Lists every settlement validator currently live on devnet with its
 * identity (from lib/oracle.ts — the single registry), a link to the
 * deployed program on the Solana Explorer, and the most recent market
 * settled through it. A validator with no settled receipt yet shows
 * its first pending market instead (the rail doubles as an announcement
 * for the first settlement of a new oracle).
 */

const EXPLORER_ADDRESS = (id: string) =>
  `https://explorer.solana.com/address/${id}?cluster=devnet`;

const VALIDATORS = [
  {
    programId: DEFAULT_ORACLE.toBase58(),
    what: "TxODDS fixture data, Merkle-proof verified on-chain",
  },
  {
    programId: PYTH_VALIDATOR_PROGRAM_ID,
    what: "Guardian-attested Pyth price, 30s freshness window",
  },
  {
    programId: ATTESTATION_VALIDATOR_PROGRAM_ID,
    what: "ed25519-signed operator observation (TheSportsDB data)",
  },
];

export function ValidatorRail() {
  const markets = useStoppageStore((s) => s.markets);

  const latestByValidator = useMemo(() => {
    const map = new Map<string, { id: string; status: string; closesAt: string }>();
    for (const m of Object.values(markets)) {
      const current = map.get(m.oracle);
      if (!current || m.closesAt > current.closesAt) {
        map.set(m.oracle, { id: m.id, status: m.status, closesAt: m.closesAt });
      }
    }
    return map;
  }, [markets]);

  return (
    <div className="op-oracles">
      {VALIDATORS.map((v) => {
        const info = oracleInfoFor(v.programId);
        const latest = latestByValidator.get(v.programId);
        return (
          <div className="op-oracle" key={v.programId}>
            <h3>{info.name}</h3>
            <p>{v.what}</p>
            <div className="op-oracle-links">
              <a href={EXPLORER_ADDRESS(v.programId)} target="_blank" rel="noopener noreferrer">
                Program ↗
              </a>
              {latest ? (
                <Link href={`/markets/${latest.id}`}>
                  {latest.status === "settled" ? "Latest settled market →" : "First settlement pending →"}
                </Link>
              ) : (
                <span>no markets yet</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
