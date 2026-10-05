/**
 * prop-desk — a self-contained operator desk. This file is the whole
 * product demo: any statement you can observe and sign, Stoppage will
 * gate a vault release on. No agent internals, no house key — just
 * @stoppage/sdk and your own attestor.
 *
 *   npx tsx examples/prop-desk/desk.ts create --slug sun-window-1 \
 *       --prop total_punts --stat prop_count --threshold 7 --minutes 240
 *   npx tsx examples/prop-desk/desk.ts list
 *   npx tsx examples/prop-desk/desk.ts pending          # exit 1 if any market is open past closes_at
 *   npx tsx examples/prop-desk/desk.ts settle sun-window-1 --value 9
 *   npx tsx examples/prop-desk/desk.ts settle sun-window-1 --espn 401872972
 *   npx tsx examples/prop-desk/desk.ts watch --espn 401872972          # dry-run proposals
 *   npx tsx examples/prop-desk/desk.ts watch --espn 401872972 --yes    # sign + settle each
 *
 * The desk keypair (DESK_KEYPAIR_PATH, default ./desk-keypair.json in
 * this folder, auto-generated and gitignored) is BOTH the payer and the
 * attestor — it creates the market, pays the refundable bond, and signs
 * the observation. Whoever holds this key can settle your markets; that
 * IS the trust model of operator attestation, and it's published so
 * anyone can audit which key settled what.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTESTATION_OPS,
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  attestationOracle,
  buildAttestationMessage,
  buildAttestVerificationIx,
  buildCreateMarketIx,
  buildInitializeAttestationConfigIx,
  buildResolveMarketIxFromOracle,
  buildSettleFromProofIx,
  deriveAttestationConfigPda,
  findMarketPdaFromPredicate,
  parseMarket,
} from "@stoppage/sdk";

// ── Your desk's claim registry ───────────────────────────────────────
// Stat keys are opaque to the validator — they're bound into the signed
// message. Publish yours so market watchers know what you attest to.
// 1–2 are Stoppage house conventions; 3–4 are shared prop conventions;
// claim your own range for anything else.
const STAT_KEYS = {
  prop_count: 3, // integer counts: punts, sacks, turnovers…
  prop_bool: 4, // 0/1: did the thing happen at all
} as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(HERE, ".desk-registry.json");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WEBHOOK = process.env.ALERT_WEBHOOK_URL;

interface PropEntry {
  matchId: string;
  slug: string;
  prop: string;
  stat: keyof typeof STAT_KEYS;
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
  fs.writeFileSync(REGISTRY, JSON.stringify(entries, null, 2));
}

function loadDesk(): Keypair {
  const p = process.env.DESK_KEYPAIR_PATH ?? path.join(HERE, "desk-keypair.json");
  if (fs.existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`generated desk keypair → ${p}`);
  console.log(`desk pubkey ${kp.publicKey.toBase58()} — publish it; it is your identity`);
  return kp;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** fixture_ref binding for prop markets: sha256("prop:<matchId>")[..16]. */
function fixtureRef(matchId: string): Uint8Array {
  return createHash("sha256").update(`prop:${matchId}`).digest().subarray(0, 16);
}

// ── Observation sources ──────────────────────────────────────────────
// The trust model never changes: the desk key signs the claim, so the
// desk IS the oracle. A source adapter only means the desk attests to a
// number pulled from a pinned public endpoint instead of one read off a
// box score by eye — market watchers can re-check the same endpoint.
// Props without an extractor still need --value; feed-free claims are
// the product's reason to exist, not a gap in it.

const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

type EspnSummary = any;

async function fetchEspnSummary(eventId: string): Promise<EspnSummary> {
  const res = await fetch(`${ESPN_SUMMARY}?event=${eventId}`, {
    headers: { "user-agent": "stoppage-prop-desk" },
  });
  if (!res.ok) throw new Error(`ESPN summary ${res.status} for event ${eventId}`);
  return res.json();
}

/** Extractor: pinned ESPN summary → (observed value, evidence detail). */
type Extractor = (s: EspnSummary) => { value: number; detail: string };

/** Sum a "X-Y" team stat (made-attempted) across both teams. */
function sumTeamStat(s: EspnSummary, name: string, label: string): { value: number; detail: string } {
  let total = 0;
  const parts: string[] = [];
  for (const team of s.boxscore?.teams ?? []) {
    const stat = (team.statistics ?? []).find((x: { name: string }) => x.name === name);
    const n = stat ? Number(String(stat.displayValue).split("-")[0]) || 0 : 0;
    total += n;
    parts.push(`${team.team.abbreviation} ${n}`);
  }
  return { value: total, detail: `${label}: ${parts.join(" + ")}` };
}

const ESPN_EXTRACTORS: Record<string, Extractor> = {
  // Punts live in player stats, not team stats — sum the "punts" column
  // of each team's "punting" group (a team with no punts has no athletes).
  total_punts: (s) => {
    let total = 0;
    const parts: string[] = [];
    for (const team of s.boxscore?.players ?? []) {
      let n = 0;
      for (const grp of team.statistics ?? []) {
        if (grp.name !== "punting") continue;
        const i = (grp.keys ?? []).indexOf("punts");
        if (i < 0) continue;
        for (const a of grp.athletes ?? []) n += Number(a.stats[i]) || 0;
      }
      total += n;
      parts.push(`${team.team.abbreviation} ${n}`);
    }
    return { value: total, detail: `punts: ${parts.join(" + ")}` };
  },
  // sacksYardsLost is sacks suffered by the offense = sacks made by the
  // opposing defense; summed across teams it's the game total.
  sacks: (s) => sumTeamStat(s, "sacksYardsLost", "sacks"),
  fourth_down_conv: (s) => sumTeamStat(s, "fourthDownEff", "4th-down conv"),
  pick_six: (s) => {
    const n = (s.scoringPlays ?? []).filter((p: { type?: { text?: string } }) =>
      /interception return/i.test(p.type?.text ?? "")
    ).length;
    return { value: n, detail: `${n} interception-return TD` };
  },
};

function observeEspn(e: PropEntry, eventId: string, summary: EspnSummary): { value: bigint; source: string } {
  const extract = ESPN_EXTRACTORS[e.prop];
  if (!extract) {
    throw new Error(`no ESPN extractor for prop "${e.prop}" — observe it yourself and use --value`);
  }
  const { value, detail } = extract(summary);
  return { value: BigInt(value), source: `espn:${eventId} (${detail})` };
}

/** The desk's word: value vs the claim's bound op/threshold. */
function outcomeFor(e: PropEntry, value: bigint): number {
  return e.op === ATTESTATION_OPS.eq
    ? value === BigInt(e.threshold) ? 0 : 1
    : e.op === ATTESTATION_OPS.lte
      ? value <= BigInt(e.threshold) ? 0 : 1
      : value >= BigInt(e.threshold) ? 0 : 1;
}

/** Observe → sign → resolve CPI → settle → attest, atomically. */
async function settleEntry(
  connection: Connection,
  desk: Keypair,
  e: PropEntry,
  value: bigint,
  source: string
): Promise<void> {
  const marketPda = new PublicKey(e.marketPda);
  const info = await connection.getAccountInfo(marketPda);
  if (!info) throw new Error(`${e.slug}: market account gone`);
  const m = parseMarket(info.data, e.marketPda);
  if (m.status !== "open") {
    console.log(`${e.slug}: already ${m.status}`);
    return;
  }
  const outcome = outcomeFor(e, value);
  console.log(`settling "${e.statement}" observed=${value} [${source}] → ${outcome === 0 ? "YES" : "NO"}`);

  await ensureConfig(connection, desk);
  const obsTs = Math.floor(Date.now() / 1000);
  const observation = { fixtureRef: fixtureRef(e.matchId), statKey: e.statKey, value, obsTs };
  const message = buildAttestationMessage(observation);
  const claim = {
    op: e.op,
    threshold: BigInt(e.threshold),
    referenceTs: e.referenceTs,
    windowSeconds: Math.max(600, obsTs - e.referenceTs + 300),
  };
  const bundle = buildSettlementBundle(desk, marketPda, e.statement, outcome, observation, claim, message);
  const sig = await sendAndConfirm(connection, desk, bundle, "settle bundle");
  console.log(`settled proof-gated, attested by ${desk.publicKey.toBase58()}: ${sig}`);
}

async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  label: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  tx.sign(payer);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const err = status.value[0]?.err;
  if (err) throw new Error(`${label} failed on-chain: ${JSON.stringify(err)} (${sig})`);
  return sig;
}

/**
 * The one CPI bundle that is the whole primitive:
 *   ed25519 verify → resolve_market (validator CPI) → settle_from_proof → attest
 * If the validator returns false, everything reverts. There is no
 * authority-only path.
 */
function buildSettlementBundle(
  desk: Keypair,
  marketPda: PublicKey,
  statement: string,
  outcome: number,
  observation: { fixtureRef: Uint8Array; statKey: number; value: bigint; obsTs: number },
  claim: { op: number; threshold: bigint; referenceTs: number; windowSeconds: number },
  message: Buffer
): TransactionInstruction[] {
  const precompileIx = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: desk.secretKey,
    message,
  });
  // Self-contained precompile ix layout: [num=1][pad][7 offsets][sig(64)][pk(32)][msg]
  const signature = new Uint8Array(precompileIx.data.subarray(16, 80));
  const resolveIx = buildResolveMarketIxFromOracle(
    attestationOracle,
    desk.publicKey,
    marketPda,
    statement,
    outcome,
    { ...observation, ...claim, authority: desk.publicKey, signature }
  );
  const settleIx = buildSettleFromProofIx(desk.publicKey, marketPda, outcome === 0 ? "yes" : "no");
  const attestIx = buildAttestVerificationIx(desk.publicKey, marketPda);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    precompileIx,
    resolveIx,
    settleIx,
    attestIx,
  ];
}

/** Pin your attestor key on the shared validator — once per desk key. */
async function ensureConfig(connection: Connection, desk: Keypair): Promise<void> {
  const oracle = new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID);
  const [configPda] = deriveAttestationConfigPda(oracle, desk.publicKey);
  const info = await connection.getAccountInfo(configPda);
  if (info) {
    const authority = new PublicKey(info.data.subarray(8, 40));
    if (!authority.equals(desk.publicKey)) {
      throw new Error(`config ${configPda.toBase58()} is pinned to ${authority.toBase58()}, not your key`);
    }
    return;
  }
  const sig = await sendAndConfirm(
    connection,
    desk,
    [buildInitializeAttestationConfigIx(desk.publicKey, desk.publicKey)],
    "initialize_config"
  );
  console.log(`initialized your attestation config ${configPda.toBase58()} (${sig})`);
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const desk = loadDesk();
  const cmd = process.argv[2];
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log("usage: desk.ts create|list|pending|settle|watch — see file header");
    return;
  }

  if (cmd === "create") {
    // --slug and --prop are required: a prop named "unnamed_prop" on the
    // public tape is worse than an error. Defaulting them let
    // `create --help` silently mint a junk market.
    const slug = arg("slug");
    const prop = arg("prop");
    if (!slug || !prop) {
      throw new Error(
        "usage: create --slug <id> --prop <what> [--stat prop_count|prop_bool] " +
          "[--threshold N] [--op gte|lte|eq] [--minutes N]"
      );
    }
    const stat = (arg("stat") ?? "prop_count") as keyof typeof STAT_KEYS;
    const statKey = STAT_KEYS[stat];
    if (statKey === undefined) throw new Error(`unknown --stat ${stat}; keys: ${Object.keys(STAT_KEYS)}`);
    const threshold = Number(arg("threshold") ?? "1");
    const op =
      arg("op") === "eq" ? ATTESTATION_OPS.eq : arg("op") === "lte" ? ATTESTATION_OPS.lte : ATTESTATION_OPS.gte;
    const minutes = Number(arg("minutes") ?? "180");
    // referenceTs = window OPEN (now) — a prop can resolve any time;
    // closes_at = betting close = now + minutes. settle_from_proof has
    // no closes_at gate, so a mid-game prop settles live.
    const referenceTs = Math.floor(Date.now() / 1000);
    const closesAt = referenceTs + minutes * 60;
    const matchId = `PROP:${prop}:${slug}:${referenceTs}`;
    const opWord = op === ATTESTATION_OPS.gte ? "over" : op === ATTESTATION_OPS.lte ? "under" : "equals";
    const statement = `${prop}_${opWord}:${threshold}:${slug}`;
    const predicate = {
      kind: "price_above" as const, // over/under semantics; the statement carries the prop
      matchId,
      params: { team: "", threshold },
    };
    const [marketPda] = findMarketPdaFromPredicate(predicate);
    const entry: PropEntry = {
      matchId, slug, prop, stat, statKey, op, threshold, referenceTs,
      marketPda: marketPda.toBase58(), statement,
    };
    const sig = await sendAndConfirm(
      connection,
      desk,
      [
        buildCreateMarketIx({
          creator: desk.publicKey,
          predicate,
          closesAt,
          oracle: new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID),
        }),
      ],
      "create_market"
    );
    saveRegistry([...loadRegistry().filter((e) => e.slug !== slug), entry]);
    console.log(`created "${statement}" → ${marketPda.toBase58()}`);
    console.log(`  tx ${sig}  closes ${new Date(closesAt * 1000).toISOString()}`);
    return;
  }

  if (cmd === "list") {
    const [configPda] = deriveAttestationConfigPda(
      new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID),
      desk.publicKey
    );
    console.log(`desk ${desk.publicKey.toBase58()} · config ${configPda.toBase58()}`);
    for (const e of loadRegistry()) {
      const info = await connection.getAccountInfo(new PublicKey(e.marketPda));
      const status = info ? parseMarket(info.data, e.marketPda).status : "gone";
      console.log(`${e.slug}: ${e.statement} [${status}] ${e.marketPda}`);
    }
    return;
  }

  if (cmd === "pending") {
    // The pager: exit 1 when a desk market is open past closes_at, so a
    // cron or healthchecks.io wrap pings you instead of silently aging
    // (the Oct 4 slate sat open ~20h for want of exactly this).
    const now = Math.floor(Date.now() / 1000);
    let overdue = 0;
    for (const e of loadRegistry()) {
      const info = await connection.getAccountInfo(new PublicKey(e.marketPda));
      if (!info) continue;
      const m = parseMarket(info.data, e.marketPda);
      if (m.status !== "open") continue;
      const closes = Math.floor(new Date(m.closesAt).getTime() / 1000);
      if (closes >= now) {
        console.log(`${e.slug}: open, closes ${m.closesAt}`);
        continue;
      }
      overdue++;
      console.error(`OVERDUE ${e.slug}: "${e.statement}" closed ${m.closesAt}, still open`);
    }
    const line = overdue ? `${overdue} market(s) overdue` : "nothing overdue";
    console.log(line);
    if (overdue && WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `prop-desk: ${line}`, source: "stoppage-prop-desk" }),
        });
      } catch { /* webhook best-effort */ }
    }
    process.exitCode = overdue ? 1 : 0;
    return;
  }

  if (cmd === "settle") {
    const slug = process.argv[3];
    const valueArg = arg("value");
    const espnEvent = arg("espn");
    const e = loadRegistry().find((x) => x.slug === slug || x.marketPda === slug);
    if (!e || (valueArg === undefined) === (espnEvent === undefined)) {
      throw new Error(
        `usage: settle <slug|pda> (--value N | --espn <eventId>) ` +
          `(registry: ${loadRegistry().map((x) => x.slug).join(", ") || "none"})`
      );
    }
    const { value, source } = espnEvent !== undefined
      ? observeEspn(e, espnEvent, await fetchEspnSummary(espnEvent))
      : { value: BigInt(Math.round(Number(valueArg!))), source: "manual" };
    await settleEntry(connection, desk, e, value, source);
    return;
  }

  if (cmd === "watch") {
    // Settle-assist: pin one ESPN event, get a proposal per open prop
    // with the extraction detail printed — the evidence you would sign.
    // Dry-run by default; --yes signs and settles each in one shot. The
    // desk key still attests every claim — this only removes the fetch/
    // transcribe steps, not the judgment of which event you pin.
    const eventId = arg("espn");
    if (!eventId) {
      throw new Error("usage: watch --espn <eventId> [--yes] — dry-run without --yes");
    }
    const yes = process.argv.includes("--yes");
    const summary = await fetchEspnSummary(eventId);
    let proposed = 0;
    for (const e of loadRegistry()) {
      const info = await connection.getAccountInfo(new PublicKey(e.marketPda));
      if (!info) {
        console.log(`${e.slug}: gone`);
        continue;
      }
      if (parseMarket(info.data, e.marketPda).status !== "open") continue;
      const extract = ESPN_EXTRACTORS[e.prop];
      if (!extract) {
        console.log(`${e.slug}: no extractor for "${e.prop}" — settle --value`);
        continue;
      }
      const obs = observeEspn(e, eventId, summary);
      proposed++;
      if (!yes) {
        const outcome = outcomeFor(e, obs.value);
        console.log(
          `${e.slug}: "${e.statement}" observed=${obs.value} [${obs.source}] → propose ${outcome === 0 ? "YES" : "NO"}`
        );
        continue;
      }
      await settleEntry(connection, desk, e, obs.value, obs.source);
    }
    if (!yes) console.log(`${proposed} proposal(s) — rerun with --yes to sign and settle`);
    return;
  }

  console.log("usage: desk.ts create|list|pending|settle|watch — see file header");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
