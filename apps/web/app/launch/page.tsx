"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  DEFAULT_ORACLE,
  PYTH_VALIDATOR_PROGRAM_ID,
  PREDICATE_LABEL,
  type PredicateKind,
} from "@stoppage/sdk";
import { useLaunchMarket } from "@/lib/markets/useLaunchMarket";
import { oracleInfoFor } from "@/lib/oracle";

/**
 * /launch — permissionless devnet market creation. The "interface" demo:
 * pick a predicate, point at any validator program, publish. Honest
 * framing: a custom-oracle market settles only if someone runs a keeper
 * for it — creating it is free-form; resolving it is the operator's job.
 */

type OracleChoice = "txline" | "pyth" | "attestation" | "custom";

const ORACLE_CHOICES: { id: OracleChoice; programId: string; blurb: string }[] = [
  { id: "txline", programId: DEFAULT_ORACLE.toBase58(), blurb: "TxODDS fixtures (settled by the Matchkeeper while live)." },
  { id: "pyth", programId: PYTH_VALIDATOR_PROGRAM_ID, blurb: "Guardian-verified price. Pair with price_above + a feed id." },
  { id: "attestation", programId: ATTESTATION_VALIDATOR_PROGRAM_ID, blurb: "Stoppage operator attestor (tsdb-linked markets)." },
  { id: "custom", programId: "", blurb: "Any deployed program that returns a bool via return data." },
];

const KINDS: PredicateKind[] = ["total_goals_over", "corners_over", "next_goal_within", "card_shown", "price_above"];

export default function LaunchPage() {
  const { publicKey } = useWallet();
  const { launch, busy, error, setError } = useLaunchMarket();

  const [kind, setKind] = useState<PredicateKind>("total_goals_over");
  const [matchId, setMatchId] = useState("");
  const [team, setTeam] = useState("");
  const [value, setValue] = useState("2");
  const [closesAt, setClosesAt] = useState("");
  const [oracleChoice, setOracleChoice] = useState<OracleChoice>("pyth");
  const [customOracle, setCustomOracle] = useState("");
  const [result, setResult] = useState<{ marketId: string; signature: string } | null>(null);

  const oracleProgramId = oracleChoice === "custom" ? customOracle : ORACLE_CHOICES.find((o) => o.id === oracleChoice)!.programId;
  const oracleValid = useMemo(() => {
    try {
      new PublicKey(oracleProgramId);
      return true;
    } catch {
      return false;
    }
  }, [oracleProgramId]);

  const valueLabel = kind === "next_goal_within" ? "Window (seconds)" : kind === "price_above" ? "Threshold (µUSD)" : "Line / threshold";

  const onPublish = async () => {
    setResult(null);
    if (!oracleValid) {
      setError("Validator program id is not a valid pubkey");
      return;
    }
    const closesAtUnix = Math.floor(new Date(closesAt).getTime() / 1000);
    const res = await launch({
      kind,
      matchId: matchId.trim(),
      team: team.trim(),
      value: Number(value),
      closesAt: closesAtUnix,
      oracle: new PublicKey(oracleProgramId),
    });
    if (res) setResult(res);
  };

  return (
    <main className="page-shell operators-page">
      <div className="page-shell-content">
        <header className="page-head page-head--compact">
          <p className="eyebrow">Build on devnet</p>
          <h1>Launch a market your validator settles.</h1>
          <p className="page-lede page-lede--short">
            The settlement contract reads one bool from whatever program you set
            as the oracle. Creation is permissionless (costs are yours; devnet
            SOL is free) — settlement is a job: a keeper for your oracle must
            call <code>resolve_market</code> when the evidence lands, or the
            market just sits. That separation is the product.
          </p>
        </header>

        <section className="op-pillar" style={{ marginTop: 24 }}>
          <div className="launch-grid">
            <label>
              Predicate
              <select value={kind} onChange={(e) => setKind(e.target.value as PredicateKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{PREDICATE_LABEL[k] ?? k}</option>
                ))}
              </select>
            </label>
            <label>
              Match / feed id {kind === "price_above" ? "(64-hex feed)" : oracleChoice === "attestation" ? "(tsdb:XXXX)" : ""}
              <input value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder={kind === "price_above" ? "9cdf3c593f9cdc4219203f1801b62e31ad824ad5c3deeb0cca4b4aca3d81aef6" : "tsdb:2406978"} />
            </label>
            <label>
              Team (optional)
              <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Orlando City SC" />
            </label>
            <label>
              {valueLabel}
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Positions close
              <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </label>
          </div>

          <fieldset className="launch-oracles">
            <legend>Settlement validator</legend>
            {ORACLE_CHOICES.map((o) => (
              <label key={o.id} className="launch-oracle-choice">
                <input type="radio" name="oracle" checked={oracleChoice === o.id} onChange={() => setOracleChoice(o.id)} />
                <span>
                  <strong>{oracleInfoFor(o.programId || "custom").name}</strong>
                  <small>{o.blurb}</small>
                </span>
              </label>
            ))}
            {oracleChoice === "custom" && (
              <label className="launch-custom-oracle">
                Validator program id
                <input value={customOracle} onChange={(e) => setCustomOracle(e.target.value)} placeholder="Paste the deployed program pubkey" />
              </label>
            )}
            <p className="launch-oracle-note">
              Custom oracle? Your keeper calls <code>resolve_market</code> with the claim; the contract CPIs into your program and
              either writes the receipt or reverts. No admin key can substitute.
            </p>
          </fieldset>

          {error && <p className="session-error">{error}</p>}
          {result && (
            <p className="position-win">
              Market live:{" "}
              <Link href={`/markets/${result.marketId}`}>open it →</Link>{" "}
              <a className="proof-explorer-link" href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            </p>
          )}

          <button className="session-action" disabled={!publicKey || busy} onClick={onPublish}>
            <span>{publicKey ? (busy ? "Publishing…" : "Publish market") : "Connect wallet to publish"}</span>
            <span>→</span>
          </button>
        </section>
      </div>
    </main>
  );
}
