/**
 * useMyPositions — fetch the connected wallet's Position accounts.
 *
 * Fetches all Position PDAs owned by the market program for the current
 * wallet (via getProgramAccounts with a memcmp on the owner field) and
 * writes them into the store. HeliusMonitor pushes live updates.
 */

import { useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { MARKET_PROGRAM_ID } from "@stoppage/sdk";
import { useStoppageStore } from "@/store";
import type { Position } from "@stoppage/sdk";

// Position layout (after 8-byte discriminator):
//   Pubkey market (32) | Pubkey owner (32) | u8 side | u64 amount | bool | u8
// Owner field starts at offset 8 + 32 = 40.
const OWNER_OFFSET = 40;

export function useMyPositions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const addPosition = useStoppageStore((s) => s.addPosition);
  const clearPositions = useStoppageStore((s) => s.clearPositions);
  const positions = useStoppageStore((s) => s.positions);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      const resp = await connection.getProgramAccounts(
        new PublicKey(MARKET_PROGRAM_ID),
        {
          commitment: "confirmed",
          filters: [
            { dataSize: 8 + 32 + 32 + 1 + 8 + 1 + 1 },
            { memcmp: { offset: OWNER_OFFSET, bytes: publicKey.toBase58() } },
          ],
        }
      );
      for (const { pubkey, account } of resp) {
        const data = account.data;
        let offset = 8;
        const marketId = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
        offset += 32; // owner (already filtered)
        const side = data.readUInt8(offset) === 0 ? "yes" : "no";
        offset += 1;
        const amountLamports = Number(data.readBigUInt64LE(offset));
        offset += 8;
        const openedViaSessionKey = data.readUInt8(offset) !== 0;
        const pos: Position = {
          marketId,
          owner: publicKey.toBase58(),
          side,
          amountLamports,
          openedViaSessionKey,
        };
        addPosition(pos);
      }
    } catch {
      // Non-fatal — positions just won't load.
    }
  }, [connection, publicKey, addPosition]);

  useEffect(() => {
    if (!publicKey) {
      clearPositions();
      return;
    }
    void refresh();
  }, [publicKey, refresh, clearPositions]);

  return { positions, refresh };
}
