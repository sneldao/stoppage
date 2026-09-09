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
  /** Pre-bet trust line shown in the bet slip before the stake is placed:
   *  the settlement guarantee, in one sentence, per validator. */
  preBetLine: string;
  /** Short validator-aware line for market faces/cards (home instrument,
   *  tape rows) where the full trust sentence is too long. */
  instrumentLine: string;
}

const ORACLE_INFO: Readonly<Record<string, OracleInfo>> = {
  [DEFAULT_ORACLE.toBase58()]: {
    name: "TxLINE",
    verifiedEyebrow: "TxLINE verified",
    proofPathEyebrow: "TxLINE proof path",
    awaitingActivity: "Waiting for TxLINE to confirm the result",
    waitingParagraph:
      "Matchkeeper is waiting for TxLINE to confirm the match. It can only settle this market after a Merkle proof of the result verifies on-chain.",
    settledParagraph:
      "This market settled only after a TxLINE proof of the result verified on-chain — in the same transaction that released the funds. You can check the receipt against the recorded outcome here.",
    preBetLine:
      "You get paid the instant the result is proven on-chain — not when someone decides it.",
    instrumentLine: "settles on a TxLINE proof, verified on-chain",
  },
  [PYTH_VALIDATOR_PROGRAM_ID]: {
    name: "Pyth",
    verifiedEyebrow: "Pyth price-verified",
    proofPathEyebrow: "Pyth proof path",
    awaitingActivity: "Waiting for a verified Pyth price",
    waitingParagraph:
      "Settles from a Pyth price reading that quorum guardians have signed within a 30-second window. The on-chain validator checks it before settling.",
    settledParagraph:
      "This market settled only after a guardian-verified Pyth price verified on-chain — in the same transaction that released the funds. Check the receipt against the recorded outcome here.",
    preBetLine:
      "You get paid the instant a verified price confirms the result on-chain — not when someone decides it.",
    instrumentLine: "settles on a verified Pyth price, checked on-chain",
  },
  [ATTESTATION_VALIDATOR_PROGRAM_ID]: {
    name: "Operator attestor",
    verifiedEyebrow: "Operator-attested",
    proofPathEyebrow: "Operator-attested proof path",
    awaitingActivity: "Waiting for the operator's attestation",
    waitingParagraph:
      "Settles at full-time from an observation signed by the operator's attestor key (data source: TheSportsDB). The signature is verified on-chain before payout. This is operator-attested — not verified by TxODDS or the network.",
    settledParagraph:
      "This market settled against an observation signed by the operator's attestor key, verified on-chain via the Ed25519 precompile. Operator-attested — not TxODDS- or network-verified. Check the receipt against the recorded outcome here.",
    preBetLine:
      "You get paid the instant the operator's signed result verifies on-chain — not when someone decides it. (The result is operator-attested, not network-checked.)",
    instrumentLine: "settles once the operator's signed result verifies on-chain",
  },
};

const CUSTOM_ORACLE_INFO: OracleInfo = {
  name: "Custom validator",
  verifiedEyebrow: "Proof-gated",
  proofPathEyebrow: "Proof path",
  awaitingActivity: "Waiting for validator confirmation",
  waitingParagraph:
    "Matchkeeper is waiting for the designated validator to confirm. It can only settle this market after the validator verifies the outcome on-chain.",
  settledParagraph:
    "This market settled only after its designated validator verified the outcome on-chain — in the same transaction that released the funds. Check the receipt against the recorded outcome here.",
  preBetLine:
    "You get paid the instant the designated validator verifies the result on-chain — not when someone decides it.",
  instrumentLine: "settles only after on-chain validator proof",
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
