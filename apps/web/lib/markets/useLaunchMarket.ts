/*
 * useLaunchMarket — permissionless market creation on devnet.
 *
 * The interface demo: anyone picks a predicate template, points at any
 * validator program (or one of the three live ones), and publishes a
 * market. Settlement of a custom-oracle market only happens if someone
 * runs a keeper that calls resolve_market against it — that is the
 * operator's job by design, and the UI says so plainly.
 *
 * Module boundary (build principles): the hook does validation + sends
 * the tx; transaction construction stays in @stoppage/sdk.
 */
"use client";

import { useCallback, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildCreateMarketIx,
  findMarketPdaFromPredicate,
  type MarketPredicate,
  type PredicateKind,
} from "@stoppage/sdk";

export interface LaunchInput {
  kind: PredicateKind;
  /** ≤32 ASCII bytes; for price_above the 64-char hex price-feed id. */
  matchId: string;
  /** ≤32 ASCII bytes; optional depending on kind. */
  team: string;
  /** threshold for over/predicates, window seconds for next_goal_within. */
  value: number;
  /** unix seconds; must be in the future. */
  closesAt: number;
  oracle: PublicKey;
}

export interface LaunchResult {
  marketId: string;
  signature: string;
}

function validate(input: LaunchInput): string | null {
  if (!input.matchId.trim()) return "Match / feed id is required";
  if (input.kind === "price_above" && !/^[0-9a-f]{64}$/i.test(input.matchId))
    return "price_above needs the 64-char hex price feed id";
  if (input.kind !== "price_above" && Buffer.from(input.matchId, "utf8").length > 32)
    return "Match / feed id exceeds 32 bytes";
  if (Buffer.from(input.team ?? "", "utf8").length > 8) return "Team id exceeds 8 bytes";
  if (input.closesAt <= Math.floor(Date.now() / 1000) + 60)
    return "Close time must be more than a minute in the future";
  return null;
}

export function useLaunchMarket() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    async (input: LaunchInput): Promise<LaunchResult | null> => {
      if (!publicKey || !sendTransaction) {
        setError("Connect a wallet to publish a market");
        return null;
      }
      const invalid = validate(input);
      if (invalid) {
        setError(invalid);
        return null;
      }

      setBusy(true);
      setError(null);
      try {
        const predicate: MarketPredicate = {
          kind: input.kind,
          matchId: input.matchId,
          params:
            input.kind === "next_goal_within"
              ? { ...(input.team ? { team: input.team } : {}), windowSeconds: input.value }
              : { ...(input.team ? { team: input.team } : {}), threshold: input.value },
        };
        // One derivation for preview AND creation (rule 6).
        const [marketPda] = findMarketPdaFromPredicate(predicate);
        const ix = buildCreateMarketIx({
          creator: publicKey,
          predicate,
          closesAt: input.closesAt,
          oracle: input.oracle,
        });
        const tx = new Transaction().add(ix);
        tx.feePayer = publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const signature = await sendTransaction(tx, connection);
        await connection.confirmTransaction(signature, "confirmed");
        return { marketId: marketPda.toBase58(), signature };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [connection, publicKey, sendTransaction]
  );

  return { launch, busy, error, setError };
}
