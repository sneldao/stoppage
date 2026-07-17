/**
 * TxLINE network configuration — the single source of truth for
 * endpoints, program IDs, and token mints per network.
 *
 * Values are from the TxLINE docs:
 *   https://txline.txodds.com/documentation/programs/devnet
 *   https://txline.txodds.com/documentation/quickstart
 */

import type { Network, NetworkConfig } from "./types";

export const TXLINE_CONFIG: Record<Network, NetworkConfig> = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlTokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlTokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
} as const;

export function getApiBase(network: Network): string {
  return `${TXLINE_CONFIG[network].apiOrigin}/api`;
}

export function getGuestAuthUrl(network: Network): string {
  return `${TXLINE_CONFIG[network].apiOrigin}/auth/guest/start`;
}

export function getActivateUrl(network: Network): string {
  return `${getApiBase(network)}/token/activate`;
}
