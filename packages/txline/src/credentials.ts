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

/**
 * Load TxLINE credentials from the saved file.
 *
 * @param baseDir - The directory to search from. Defaults to process.cwd().
 *                  The function checks baseDir, then parent directories.
 */
export function loadCredentials(
  baseDir?: string
): { network: Network; creds: TxLineCredentials } {
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
  throw new Error("TxLINE credentials not found — run scripts/subscribe-txline.ts first");
}
