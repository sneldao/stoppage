/**
 * useMarketActions — join, claim, and create-market orchestration.
 *
 * Boundary (CLAUDE.md): components never build transactions. This hook
 * composes @stoppage/sdk instruction builders with the wallet adapter
 * (for wallet-signed actions) and signWithSessionKey (for the no-popup
 * join — rule 5). Results are reflected into the store by callers.
 *
 * HARD GATE: join methods validate fixture availability before building
 * transactions. Cannot bet on markets without match data (trust violation:
 * users staking SOL on conditions they can't verify).
 */

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  buildJoinViaWalletIx,
  buildJoinViaSessionKeyIx,
  buildClaimIx,
  buildCreateMarketIx,
  buildAttestVerificationIx,
  buildResolveMarketIx,
  buildTxlineValidateStatData,
  DEFAULT_ORACLE,
  signAndConfirmWithSessionKey,
  findPositionPda,
  getMarket,
  type Side,
  type MarketPredicate,
} from "@stoppage/sdk";
import type { Keypair } from "@solana/web3.js";
import { useStoppageStore } from "@/store";
import { validateFixtureForBetting } from "./fixtureValidator";

export interface JoinParams {
  market: PublicKey;
  side: Side;
  amountLamports: number;
}

export interface ActionResult {
  signature: string;
  submittedAt: number;
  confirmedAt: number;
  signingMs?: number;
}

export interface CreateMarketArgs {
  predicate: MarketPredicate;
  closesAt: number; // unix seconds
}

export function useMarketActions() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const sendWalletTx = useCallback(
    async (ix: Awaited<ReturnType<typeof buildJoinViaWalletIx>>) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);
      const signingStartedAt = performance.now();
      const signature = await sendTransaction(tx, connection);
      const submittedAt = Date.now();
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      return {
        signature,
        submittedAt,
        confirmedAt: Date.now(),
        // Wallet interaction is included because the adapter owns signing.
        signingMs: performance.now() - signingStartedAt,
      } satisfies ActionResult;
    },
    [connection, publicKey, sendTransaction]
  );

  /**
   * Validate fixture availability for a market before allowing join.
   * Reads fixtures from store synchronously — no async fetch needed.
   */
  const validateFixture = useCallback((marketAddr: PublicKey): void => {
    const { fixtures, markets } = useStoppageStore.getState();
    const validation = validateFixtureForBetting(markets, fixtures, marketAddr);
    if (!validation.canBet) {
      throw new Error(validation.reason ?? "Cannot place bet on this market");
    }
  }, []);

  /**
   * Join via the connected wallet (one popup).
   * HARD GATE: validates fixture availability before building transaction.
   */
  const joinViaWallet = useCallback(
    async ({ market, side, amountLamports }: JoinParams) => {
      if (!publicKey) throw new Error("Wallet not connected");
      
      // Gate: cannot bet without fixture data
      validateFixture(market);
      
      const ix = buildJoinViaWalletIx(publicKey, market, side, amountLamports);
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx, validateFixture]
  );

  /**
   * Join via a session key — NO wallet popup (rule 5). The session key
   * signs and pays; the position is attributed to the owner wallet.
   * HARD GATE: validates fixture availability before building transaction.
   */
  const joinViaSessionKey = useCallback(
    async (
      sessionKeypair: Keypair,
      owner: PublicKey,
      { market, side, amountLamports }: JoinParams
    ) => {
      // Gate: cannot bet without fixture data
      validateFixture(market);
      
      const ix = buildJoinViaSessionKeyIx(
        sessionKeypair.publicKey,
        owner,
        market,
        side,
        amountLamports
      );
      return signAndConfirmWithSessionKey(connection, sessionKeypair, [ix]);
    },
    [connection, validateFixture]
  );

  /** Claim a settled position (wallet signs). Records to history. */
  const claim = useCallback(
    async (market: PublicKey) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildClaimIx(publicKey, market);
      const result = await sendWalletTx(ix);

      // Record the settled position in history (for stats/leaderboard)
      try {
        const m = await getMarket(connection, market);
        const positions = useStoppageStore.getState().positions;
        const pos = positions[`${market.toBase58()}:${publicKey.toBase58()}`];
        if (pos && (m.status === "settled" || m.status === "void")) {
          const payoutLamports = m.status === "void"
            ? pos.amountLamports // full refund
            : pos.side === m.outcome
            ? Math.floor((pos.amountLamports * (m.yesPool + m.noPool)) /
              (pos.side === "yes" ? m.yesPool : m.noPool))
            : 0;
          useStoppageStore.getState().addSettledPosition({
            marketId: market.toBase58(),
            owner: publicKey.toBase58(),
            side: pos.side,
            amountLamports: pos.amountLamports,
            outcome: m.outcome ?? "void",
            payoutLamports,
            settledAt: Date.now(),
            label: `${m.predicate.kind} ${m.predicate.params.windowSeconds ?? m.predicate.params.threshold ?? ""}`,
          });
        }
      } catch {
        // Non-fatal — history just won't be recorded
      }

      return result;
    },
    [connection, publicKey, sendWalletTx]
  );

  /** Create a market (wallet signs, pays the bond). */
  const createMarket = useCallback(
    async ({ predicate, closesAt }: CreateMarketArgs) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildCreateMarketIx({
        creator: publicKey,
        predicate,
        closesAt,
        oracle: DEFAULT_ORACLE,
      });
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx]
  );

  /** Permissionless attestation — anyone can verify a settled market. */
  const attestVerification = useCallback(
    async (market: PublicKey) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildAttestVerificationIx(publicKey, market);
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx]
  );

  /** Derive the position PDA for the connected wallet on a market. */
  const myPositionPda = useCallback(
    (market: PublicKey): PublicKey | null => {
      if (!publicKey) return null;
      const [pda] = findPositionPda(market, publicKey);
      return pda;
    },
    [publicKey]
  );

  return {
    joinViaWallet,
    joinViaSessionKey,
    claim,
    createMarket,
    attestVerification,
    myPositionPda,
  };
}
