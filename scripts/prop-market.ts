/**
 * Prop-market CLI — create and settle arbitrary attestation-oracle
 * markets from the command line. This is the stream tool and the
 * second-tenant demo: any observation you can sign, the settlement
 * primitive will gate a vault release on.
 *
 *   npx tsx scripts/prop-market.ts create --slug browns-steelers \
 *       --prop "total_punts" --stat prop_count --threshold 7 --minutes 240
 *   npx tsx scripts/prop-market.ts list
 *   npx tsx scripts/prop-market.ts settle browns-steelers --value 9
 *
 * Keys: payer = SOLANA_KEYPAIR_PATH (or .runtime/operator-quickstart.json
 * — a second tenant, proving multi-tenancy); attestor =
 * ATTESTOR_KEYPAIR_PATH (defaults to the payer — self-attested props).
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  ATTESTATION_OPS,
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  buildAttestationMessage,
  buildCreateMarketIx,
  findMarketPdaFromPredicate,
  parseMarket,
} from "@stoppage/sdk";
import {
  ATTEST_STAT_KEYS,
  buildSettlementBundle,
  ensureAttestationConfig,
  fixtureRefForPropMarket,
  sendAndConfirm,
} from "../apps/agent/src/attestationKeeper";

const RUNTIME = path.resolve(__dirname, "../.runtime");
const REGISTRY = path.join(RUNTIME, "prop-markets.json");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

interface PropEntry {
  matchId: string;
  slug: string;
  prop: string;
  stat: keyof typeof ATTEST_STAT_KEYS;
  statKey: number;
  op: number;
  threshold: number;
  referenceTs: number;
  marketPda: string;
  statement: string;
}

function loadRegistry(): PropEntry[] {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  } catch {
    return [];
  }
}

function saveRegistry(entries: PropEntry[]): void {
  fs.mkdirSync(RUNTIME, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(entries, null, 2));
}

function loadKeypair(env: string | undefined, fallbackFile: string): Keypair {
  const p = env ? path.resolve(env) : path.join(RUNTIME, fallbackFile);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const wallet = loadKeypair(process.env.SOLANA_KEYPAIR_PATH, "operator-quickstart.json");
  const attestor = process.env.ATTESTOR_KEYPAIR_PATH
    ? loadKeypair(process.env.ATTESTOR_KEYPAIR_PATH, "operator-quickstart.json")
    : wallet;
  const cfg = { connection, wallet, attestor, dryRun: false };
  const cmd = process.argv[2];

  if (cmd === "create") {
    const slug = arg("slug") ?? `prop-${Date.now()}`;
    const prop = arg("prop") ?? "unnamed_prop";
    const stat = (arg("stat") ?? "prop_count") as keyof typeof ATTEST_STAT_KEYS;
    const statKey = ATTEST_STAT_KEYS[stat];
    if (statKey === undefined) throw new Error(`unknown --stat ${stat}; keys: ${Object.keys(ATTEST_STAT_KEYS)}`);
    const threshold = Number(arg("threshold") ?? "1");
    const op = arg("op") === "eq" ? ATTESTATION_OPS.eq : arg("op") === "lte" ? ATTESTATION_OPS.lte : ATTESTATION_OPS.gte;
    const minutes = Number(arg("minutes") ?? "180");
    // referenceTs = window OPEN (now) — a prop can resolve any time;
    // closes_at = betting close = now + minutes. settle_from_proof has
    // no closes_at gate, so a mid-game prop settles live on stream.
    const referenceTs = Math.floor(Date.now() / 1000);
    const closesAt = referenceTs + minutes * 60;
    const matchId = `PROP:${slug}:${referenceTs}`;
    const opWord = op === ATTESTATION_OPS.gte ? "over" : op === ATTESTATION_OPS.lte ? "under" : "equals";
    const statement = `${prop}_${opWord}:${threshold}:${slug}`;
    const predicate = {
      kind: "price_above" as const, // over/under param semantics — statement carries the prop
      matchId,
      params: { team: "", threshold },
    };
    const [marketPda] = findMarketPdaFromPredicate(predicate);
    const entry: PropEntry = {
      matchId, slug, prop, stat, statKey, op, threshold, referenceTs,
      marketPda: marketPda.toBase58(), statement,
    };
    await sendAndConfirm(cfg, [
      buildCreateMarketIx({
        creator: wallet.publicKey,
        predicate,
        closesAt,
        oracle: new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID),
      }),
    ], "create_market");
    saveRegistry([...loadRegistry().filter((e) => e.slug !== slug), entry]);
    console.log(`created "${statement}" → ${marketPda.toBase58()} (closes ${new Date(closesAt * 1000).toISOString()})`);
    return;
  }

  if (cmd === "list") {
    for (const e of loadRegistry()) {
      const info = await connection.getAccountInfo(new PublicKey(e.marketPda));
      const status = info ? parseMarket(info.data, e.marketPda).status : "gone";
      console.log(`${e.slug}: ${e.statement} [${status}] ${e.marketPda}`);
    }
    return;
  }

  if (cmd === "settle") {
    const slug = process.argv[3];
    const valueArg = arg("value");
    const e = loadRegistry().find((x) => x.slug === slug || x.marketPda === slug);
    if (!e || valueArg === undefined) {
      throw new Error(`usage: settle <slug|pda> --value N (registry keys: ${loadRegistry().map((x) => x.slug).join(", ") || "none"})`);
    }
    const marketPda = new PublicKey(e.marketPda);
    const info = await connection.getAccountInfo(marketPda);
    if (!info) throw new Error("market account gone");
    const m = parseMarket(info.data, e.marketPda);
    if (m.status !== "open") {
      console.log(`already ${m.status}`);
      return;
    }
    const value = BigInt(Math.round(Number(valueArg)));
    const outcome = e.op === ATTESTATION_OPS.eq ? (value === BigInt(e.threshold) ? 0 : 1)
      : e.op === ATTESTATION_OPS.lte ? (value <= BigInt(e.threshold) ? 0 : 1)
      : value >= BigInt(e.threshold) ? 0 : 1;
    console.log(`settling "${e.statement}" observed=${value} → ${outcome === 0 ? "YES" : "NO"}`);

    await ensureAttestationConfig(cfg);
    const obsTs = Math.floor(Date.now() / 1000);
    const observation = {
      fixtureRef: fixtureRefForPropMarket(e.matchId),
      statKey: e.statKey,
      value,
      obsTs,
    };
    const message = buildAttestationMessage(observation);
    const claim = {
      op: e.op,
      threshold: BigInt(e.threshold),
      referenceTs: e.referenceTs,
      windowSeconds: Math.max(600, obsTs - e.referenceTs + 300),
    };
    const bundle = buildSettlementBundle(cfg, marketPda, e.statement, outcome, observation, claim, message);
    const sig = await sendAndConfirm(cfg, bundle, "settle bundle");
    console.log(`settled (proof-gated, attested by ${attestor.publicKey.toBase58()}): ${sig}`);
    return;
  }

  console.log("usage: prop-market.ts create|list|settle — see file header");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
