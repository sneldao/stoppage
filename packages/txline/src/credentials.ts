/**
 * Credential loading utility — reads the .txline-credentials.json file
 * written by scripts/subscribe-txline.ts.
 *
 * Single source of truth for credential loading (rule 6 — DRY).
 * Both the agent and the web API route use this.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { Network, TxLineCredentials } from "./types";

function loadEnvironmentCredentials(): { network: Network; creds: TxLineCredentials } | null {
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  const network = process.env.TXLINE_NETWORK;

  if (!jwt && !apiToken && !network) return null;

  if (!jwt || !apiToken) {
    throw new Error("TXLINE_JWT and TXLINE_API_TOKEN must both be set");
  }
  if (network !== "devnet" && network !== "mainnet") {
    throw new Error("TXLINE_NETWORK must be devnet or mainnet");
  }

  return { network, creds: { jwt, apiToken } };
}

/**
 * Load TxLINE credentials from the saved file.
 *
 * @param baseDir - The directory to search from. Defaults to process.cwd().
 *                  The function checks baseDir, then parent directories.
 */
export function loadCredentials(
  baseDir?: string
): { network: Network; creds: TxLineCredentials } {
  const environmentCredentials = loadEnvironmentCredentials();
  if (environmentCredentials) return environmentCredentials;

  const cwd = baseDir ?? process.cwd();
  const paths = [
    join(cwd, ".txline-credentials.json"),
    join(cwd, "..", "..", ".txline-credentials.json"),
  ];

  for (const p of paths) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      return {
        network: data.network as Network,
        creds: { jwt: data.jwt, apiToken: data.apiToken },
      };
    } catch {
      // try next path
    }
  }
  throw new Error(
    "TxLINE credentials not found — set TXLINE_JWT, TXLINE_API_TOKEN, and TXLINE_NETWORK, or run scripts/subscribe-txline.ts first"
  );
}
