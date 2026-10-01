/**
 * One-off verification: end-to-end attested price settle on devnet.
 * PRICE_ORACLE=attestation — creates a price_above market bound to the
 * attestation validator, waits for its reference candle, then settles
 * via the operator-signed Coinbase observation path. Run:
 *
 *   PRICE_ORACLE=attestation npx tsx scripts/_verify-attested-price.ts
 */
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { parseMarket } from "@stoppage/sdk";
import {
  ensurePriceMarket,
  settlePriceMarket,
  type PythMarketContext,
} from "../apps/agent/src/priceKeeper";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("secrets/demo-opponent-gamma-keypair.json", "utf8"))
    )
  );
  console.log("wallet:", wallet.publicKey.toBase58());
  console.log("balance:", (await connection.getBalance(wallet.publicKey)) / 1e9, "SOL");

  const ctx: PythMarketContext = {
    connection,
    wallet,
    dryRun: false,
    log: (m) => console.log(`[pk] ${m}`),
    tracked: new Map(),
    onSettled: (_m, fact) =>
      console.log(
        "SETTLED:",
        JSON.stringify({ ...fact, observedPrice: fact.observedPrice.toString() })
      ),
    onVoided: (_m, sig) => console.log("VOIDED:", sig),
  };

  // Reference = next minute boundary + 60s — the market's observation
  // candle closes ~60s after ref, so a settle succeeds ~2min in.
  const ref = Math.ceil(Date.now() / 1000 / 60) * 60 + 60;
  const m = await ensurePriceMarket(ctx, {
    matchId: `SOL/USD-ATTEST:${ref}`,
    referenceTs: ref,
  });
  console.log(`market ${m?.marketPda.toBase58()} ref=${ref} (${new Date(ref * 1000).toISOString()})`);

  // Poll until the reference candle is available and the bundle lands.
  for (let i = 0; i < 60; i++) {
    const tracked = ctx.tracked.get(m!.marketPda.toBase58());
    if (!tracked) break;
    if (Math.floor(Date.now() / 1000) < ref) {
      await sleep(5000);
      continue;
    }
    try {
      const result = await settlePriceMarket(ctx, tracked);
      console.log(`settle attempt ${i}: ${result}`);
      if (result === "settled") break;
    } catch (e) {
      console.log(`settle attempt ${i} threw: ${e}`);
    }
    await sleep(10_000);
  }

  const info = await connection.getAccountInfo(m!.marketPda);
  if (!info) throw new Error("market account gone?");
  const parsed = parseMarket(info.data, m!.marketPda.toBase58());
  console.log("final market status:", parsed.status, "outcome:", parsed.outcome, "oracle:", parsed.oracle);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
