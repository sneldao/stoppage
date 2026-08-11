import { expect } from "chai";
import { Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  ATTESTATION_MSG_LEN,
  ATTESTATION_OPS,
  ATTESTATION_MSG_PREFIX,
  attestationObservationDigest,
  attestationOracle,
  buildAttestationMessage,
  deriveAttestationConfigPda,
  type AttestationProof,
} from "./oracle";
import { ATTESTATION_VALIDATOR_PROGRAM_ID } from "./programIds";
import { sha256 } from "js-sha256";

const fixtureRef = new Uint8Array(16).map((_, i) => i + 1);
const authority = Keypair.generate().publicKey;
const signature = new Uint8Array(64).map((_, i) => 255 - i);

const baseProof: AttestationProof = {
  authority,
  fixtureRef,
  statKey: 1,
  value: 4n,
  obsTs: 1_800_000_100,
  signature,
  op: ATTESTATION_OPS.gte,
  threshold: 3n,
  referenceTs: 1_800_000_000,
  windowSeconds: 3600,
};

describe("attestation oracle adapter", () => {
  describe("buildAttestationMessage", () => {
    it("encodes the 66-byte observation message byte-for-byte", () => {
      const msg = buildAttestationMessage(baseProof);
      expect(msg.length).to.equal(ATTESTATION_MSG_LEN);
      expect(msg.subarray(0, 30).equals(ATTESTATION_MSG_PREFIX)).to.be.true;
      expect(Array.from(msg.subarray(30, 46))).to.deep.equal(Array.from(fixtureRef));
      expect(msg.readUInt32LE(46)).to.equal(1);
      expect(msg.readBigInt64LE(50)).to.equal(4n);
      expect(msg.readBigInt64LE(58)).to.equal(1_800_000_100n);
    });

    it("rejects a fixtureRef that is not 16 bytes", () => {
      expect(() =>
        buildAttestationMessage({ ...baseProof, fixtureRef: new Uint8Array(15) })
      ).to.throw(/16 bytes/);
    });
  });

  describe("attestationOracle.buildVerifySpec", () => {
    it("targets the canonical attestation validator with config + instructions sysvar anchors", () => {
      const spec = attestationOracle.buildVerifySpec({
        outcome: 0,
        statement: "total_goals_over:2.5:NY-LA",
        proof: baseProof,
      });
      expect(spec.validatorProgram.toBase58()).to.equal(ATTESTATION_VALIDATOR_PROGRAM_ID);
      const [configPda] = deriveAttestationConfigPda(
        new PublicKey(ATTESTATION_VALIDATOR_PROGRAM_ID)
      );
      expect(spec.anchorAccounts[0].toBase58()).to.equal(configPda.toBase58());
      expect(spec.anchorAccounts[1].toBase58()).to.equal(
        SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()
      );
    });

    it("encodes discriminator + args in the Rust arg order (65 bytes)", () => {
      const spec = attestationOracle.buildVerifySpec({
        outcome: 0,
        statement: "s",
        proof: baseProof,
      });
      const d = spec.instructionData;
      expect(d.length).to.equal(8 + 16 + 4 + 1 + 8 + 8 + 8 + 8 + 4);
      // Discriminator = sha256("global:validate_attestation")[..8]
      expect(Array.from(d.subarray(0, 8))).to.deep.equal(
        sha256.array("global:validate_attestation").slice(0, 8)
      );
      // fixture_ref [16] @ 8, stat_key u32 @ 24, op u8 @ 28
      expect(Array.from(d.subarray(8, 24))).to.deep.equal(Array.from(fixtureRef));
      expect(d.readUInt32LE(24)).to.equal(1);
      expect(d[28]).to.equal(ATTESTATION_OPS.gte);
      // threshold/value/obs_ts/reference_ts i64 @ 29/37/45/53, window u32 @ 61
      expect(d.readBigInt64LE(29)).to.equal(3n);
      expect(d.readBigInt64LE(37)).to.equal(4n);
      expect(d.readBigInt64LE(45)).to.equal(1_800_000_100n);
      expect(d.readBigInt64LE(53)).to.equal(1_800_000_000n);
      expect(d.readUInt32LE(61)).to.equal(3600);
    });

    it("produces a digest that commits to authority, payload, and signature", () => {
      const a = attestationObservationDigest(baseProof);
      expect(a.length).to.equal(32);
      // Stable for identical inputs
      expect(Buffer.from(a).equals(Buffer.from(attestationObservationDigest(baseProof)))).to.be.true;
      // Changes if any committed field changes
      expect(
        Buffer.from(a).equals(
          Buffer.from(attestationObservationDigest({ ...baseProof, value: 5n }))
        )
      ).to.be.false;
      const otherSig = new Uint8Array(64).fill(7);
      expect(
        Buffer.from(a).equals(
          Buffer.from(attestationObservationDigest({ ...baseProof, signature: otherSig }))
        )
      ).to.be.false;
    });

    it("rejects a signature that is not 64 bytes", () => {
      expect(() =>
        attestationObservationDigest({ ...baseProof, signature: new Uint8Array(63) })
      ).to.throw(/64 bytes/);
    });
  });
});
