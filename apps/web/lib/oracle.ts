/*
 * Oracle labeling — the SINGLE source of truth for how each settlement
 * validator is presented in the UI (rule 6). Keyed by `market.oracle`
 * (the validator program pubkey parsed from the market account), so the
 * label follows the on-chain fact rather than copy drift.
 *
 * Honesty rule (ATTESTATION-ORACLE.md): attestation labels must say
 * "operator-attested" — never imply TxODDS verification, network
 * verification, or Pyth aggregation.
 */
import {
  ATTESTATION_VALIDATOR_PROGRAM_ID,
  DEFAULT_ORACLE,
  PYTH_VALIDATOR_PROGRAM_ID,
} from "@stoppage/sdk";

export interface OracleInfo {
  /** Short name: "TxLINE", "Pyth", "Operator attestor". */
  name: string;
  /** Eyebrow for the settled proof panel. */
  verifiedEyebrow: string;
  /** Eyebrow for the resolution-path timeline. */
  proofPathEyebrow: string;
  /** One-line activity copy while awaiting settlement. */
  awaitingActivity: string;
  /** Paragraph for the open/awaiting proof panel. */
  waitingParagraph: string;
  /** Paragraph for the settled proof panel. */
  settledParagraph: string;
}

const ORACLE_INFO: Readonly<Record<string, OracleInfo>> = {
  [DEFAULT_ORACLE.toBase58()]: {
    name: "TxLINE",
    verifiedEyebrow: "TxLINE verified",
    proofPathEyebrow: "TxLINE proof path",
    awaitingActivity: "Waiting for TxLINE confirmation",
    waitingParagraph:
      "Matchkeeper is watching for TxLINE confirmation. It can submit this market's settlement only after the required proof validates on-chain.",
    settledParagraph:
      "The program settled this market only after TxLINE proof validation on-chain. This view checks the settlement receipt against the recorded outcome.",
  },
  [PYTH_VALIDATOR_PROGRAM_ID]: {
    name: "Pyth",
    verifiedEyebrow: "Pyth price-verified",
    proofPathEyebrow: "Pyth proof path",
    awaitingActivity: "Waiting for guardian-verified Pyth price",
    waitingParagraph:
      "Settles from a Pyth price observation (guardian-attested, 30s freshness) read by the Pyth validator program on-chain.",
    settledParagraph:
      "The program settled this market only after a guardian-verified Pyth price observation validated on-chain. This view checks the settlement receipt against the recorded outcome.",
  },
  [ATTESTATION_VALIDATOR_PROGRAM_ID]: {
    name: "Operator attestor",
    verifiedEyebrow: "Operator-attested",
    proofPathEyebrow: "Operator-attested proof path",
    awaitingActivity: "Waiting for operator attestation",
    waitingParagraph:
      "Settles at full-time from an observation signed by the operator's attestor key (data source: TheSportsDB). The ed25519 signature is verified on-chain before settlement.",
    settledParagraph:
      "The program settled this market against an observation signed by the operator's attestor key, verified on-chain via the ed25519 precompile. Operator-attested — not TxODDS- or network-verified. This view checks the settlement receipt against the recorded outcome.",
  },
};

const CUSTOM_ORACLE_INFO: OracleInfo = {
  name: "Custom validator",
  verifiedEyebrow: "Proof-gated",
  proofPathEyebrow: "Proof path",
  awaitingActivity: "Waiting for validator confirmation",
  waitingParagraph:
    "Matchkeeper is watching for validator confirmation. It can submit this market's settlement only after the designated validator program verifies the outcome on-chain.",
  settledParagraph:
    "The program settled this market only after its designated validator program returned true on-chain. This view checks the settlement receipt against the recorded outcome.",
};

/** Resolve UI copy for a market's `oracle` program id (from the parsed market account). */
export function oracleInfoFor(oracleProgramId: string | null | undefined): OracleInfo {
  if (!oracleProgramId) return CUSTOM_ORACLE_INFO;
  return ORACLE_INFO[oracleProgramId] ?? CUSTOM_ORACLE_INFO;
}

/** True when the market uses the baseline TxLINE validator (the common case). */
export function isBaselineOracle(oracleProgramId: string | null | undefined): boolean {
  return !oracleProgramId || oracleProgramId === DEFAULT_ORACLE.toBase58();
}
