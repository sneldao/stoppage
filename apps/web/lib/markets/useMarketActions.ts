/**
 * useMarketActions — join, claim, and create-market orchestration.
 *
 * Boundary (CLAUDE.md): components never build transactions. This hook
 * composes @stoppage/sdk instruction builders with the wallet adapter
 * (for wallet-signed actions) and signWithSessionKey (for the no-popup
 * join — rule 5). Results are reflected into the store by callers.
 */

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  buildJoinViaWalletIx,
  buildJoinViaSessionKeyIx,
  buildClaimIx,
  buildCreateMarketIx,
  buildForceSettleIx,
  buildAttestVerificationIx,
  signWithSessionKey,
  findPositionPda,
  type Side,
  type MarketPredicate,
} from "@stoppage/sdk";
import type { Keypair } from "@solana/web3.js";

export interface JoinParams {
  market: PublicKey;
  side: Side;
  amountLamports: number;
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
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [connection, publicKey, sendTransaction]
  );

  /** Join via the connected wallet (one popup). */
  const joinViaWallet = useCallback(
    async ({ market, side, amountLamports }: JoinParams) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildJoinViaWalletIx(publicKey, market, side, amountLamports);
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx]
  );

  /**
   * Join via a session key — NO wallet popup (rule 5). The session key
   * signs and pays; the position is attributed to the owner wallet.
   */
  const joinViaSessionKey = useCallback(
    async (
      sessionKeypair: Keypair,
      owner: PublicKey,
      { market, side, amountLamports }: JoinParams
    ) => {
      const ix = buildJoinViaSessionKeyIx(
        sessionKeypair.publicKey,
        owner,
        market,
        side,
        amountLamports
      );
      return signWithSessionKey(connection, sessionKeypair, [ix]);
    },
    [connection]
  );

  /** Claim a settled position (wallet signs). */
  const claim = useCallback(
    async (market: PublicKey) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildClaimIx(publicKey, market);
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx]
  );

  /** Create a market (wallet signs, pays the bond). */
  const createMarket = useCallback(
    async ({ predicate, closesAt }: CreateMarketArgs) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildCreateMarketIx({
        creator: publicKey,
        predicate,
        closesAt,
      });
      return sendWalletTx(ix);
    },
    [publicKey, sendWalletTx]
  );

  /** Authority-only mock settle (M2 acceptance / demo). */
  const forceSettle = useCallback(
    async (market: PublicKey, outcome: Side) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ix = buildForceSettleIx(publicKey, market, outcome);
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
    forceSettle,
    attestVerification,
    myPositionPda,
  };
}
