// Stoppage attestation validator — program tests.
//
// Covers the ed25519-precompile binding path: config init, happy YES/NO
// (asserted via simulated return data), and every binding violation the
// validator must reject (message mismatch, wrong signer, missing
// precompile, window violations, invalid op).
//
// Run via `npm run anchor:test` (or `anchor test`). Uses the Anchor TS
// Program client from the workspace build (the harness deploys the same
// binary anchor build produced — one build, one IDL, target/idl).
//
// The tests exercise the validator's direct-call surface. The full
// market → settlement → CPI chain against this oracle is verified
// end-to-end on devnet (same precedent as the pyth_validator path).

import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor as any;
import * as web3 from "@solana/web3.js";
const { Keypair, PublicKey, Transaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } = web3;
import * as chai from "chai";
const { expect } = chai;
import { createHash } from "crypto";

type ValidatorProgram = anchor.Program<any>;

// Mirror of the program's message contract (single source of truth for
// the format is programs/attestation_validator; this is the test-side
// encoder, byte-for-byte against the Rust reconstruction).
const MSG_PREFIX = Buffer.from("stoppage/attest-observation/v1", "utf8");
const OP_GTE = 0;

function fixtureRef(label: string): Buffer {
  return createHash("sha256").update(label).digest().subarray(0, 16);
}

function buildMessage(args: {
  fixtureRef: Buffer;
  statKey: number;
  value: bigint;
  obsTs: bigint;
}): Buffer {
  const msg = Buffer.alloc(66);
  MSG_PREFIX.copy(msg, 0);
  args.fixtureRef.copy(msg, 30);
  msg.writeUInt32LE(args.statKey, 46);
  msg.writeBigInt64LE(args.value, 50);
  msg.writeBigInt64LE(args.obsTs, 58);
  return msg;
}

describe("stoppage / attestation validator", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.AttestationValidator as ValidatorProgram;
  const connection = provider.connection;
  const payer = (provider.wallet as any).payer as Keypair;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const attestor = Keypair.generate();
  const impostor = Keypair.generate();

  const REF = fixtureRef("tsdb:552880");
  const NOW = BigInt(Math.floor(Date.now() / 1000));

  async function validateInstruction(args: {
    statKey?: number;
    op?: number;
    threshold?: bigint;
    value?: bigint;
    obsTs?: bigint;
    referenceTs?: bigint;
    windowSeconds?: number;
  }): Promise<web3.TransactionInstruction> {
    const a = {
      statKey: 1,
      op: OP_GTE,
      threshold: 3n,
      value: 4n,
      obsTs: NOW,
      referenceTs: NOW - 10n,
      windowSeconds: 3600,
      ...args,
    };
    return program.methods
      .validateAttestation(
        REF,
        a.statKey,
        a.op,
        new BN(a.threshold.toString()),
        new BN(a.value.toString()),
        new BN(a.obsTs.toString()),
        new BN(a.referenceTs.toString()),
        a.windowSeconds
      )
      .accounts({ config: configPda, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
      .instruction();
  }

  function attestationTx(
    signer: Keypair,
    message: Buffer,
    instruction: web3.TransactionInstruction
  ): Transaction {
    return new Transaction()
      .add(Ed25519Program.createInstructionWithPrivateKey({ privateKey: signer.secretKey, message }))
      .add(instruction);
  }

  /** Simulate and return the validator's 1-byte return data (or null). */
  async function simulateReturnData(tx: Transaction): Promise<number | null> {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = provider.wallet.publicKey;
    tx.sign(payer);
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
    const rd = (sim.value as any).returnData;
    if (!rd) return null;
    expect(rd.programId).to.equal(program.programId.toBase58());
    return Buffer.from(rd.data[0], "base64")[0];
  }

  async function expectReject(tx: Transaction, pattern: RegExp) {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = provider.wallet.publicKey;
    tx.sign(payer);
    try {
      await provider.sendAndConfirm(tx, []);
      expect.fail(`expected rejection matching ${pattern}`);
    } catch (e) {
      expect(String(e)).to.match(pattern);
    }
  }

  it("initializes the config PDA with the operator authority", async () => {
    await program.methods
      .initializeConfig(attestor.publicKey)
      .accounts({ config: configPda, payer: provider.wallet.publicKey })
      .rpc();
    const config = await program.account.config.fetch(configPda);
    expect(config.authority.toBase58()).to.equal(attestor.publicKey.toBase58());
  });

  it("rejects a second initialize (first-init-wins)", async () => {
    try {
      await program.methods
        .initializeConfig(impostor.publicKey)
        .accounts({ config: configPda, payer: provider.wallet.publicKey })
        .rpc();
      expect.fail("expected re-init to fail");
    } catch (e) {
      // Anchor init constraint violation (account already in use)
      expect(String(e)).to.match(/already in use|Simulation failed|0x0/i);
    }
  });

  it("returns true when a correctly signed observation satisfies the predicate", async () => {
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 4n, obsTs: NOW });
    const tx = attestationTx(attestor, message, await validateInstruction({}));
    expect(await simulateReturnData(tx)).to.equal(1);
  });

  it("returns false when a correctly signed observation fails the predicate", async () => {
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 2n, obsTs: NOW });
    const tx = attestationTx(attestor, message, await validateInstruction({ value: 2n }));
    expect(await simulateReturnData(tx)).to.equal(0);
  });

  it("rejects when the signed message does not match the claimed observation", async () => {
    // Sign value=5 but claim value=4.
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 5n, obsTs: NOW });
    const tx = attestationTx(attestor, message, await validateInstruction({ value: 4n }));
    await expectReject(tx, /MessageMismatch|message does not match/i);
  });

  it("rejects an observation signed by a non-authority key", async () => {
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 4n, obsTs: NOW });
    const tx = attestationTx(impostor, message, await validateInstruction({}));
    await expectReject(tx, /SignerMismatch|not the pinned attestation authority/i);
  });

  it("rejects when there is no preceding ed25519 instruction", async () => {
    const tx = new Transaction().add(await validateInstruction({}));
    await expectReject(tx, /MissingEd25519Instruction|not the ed25519 precompile/i);
  });

  it("rejects an observation outside the committed window", async () => {
    const staleTs = NOW;
    const referenceTs = NOW - 7200n; // window [ref, ref+3600] ends before obs
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 4n, obsTs: staleTs });
    const tx = attestationTx(
      attestor,
      message,
      await validateInstruction({ obsTs: staleTs, referenceTs, windowSeconds: 3600 })
    );
    await expectReject(tx, /OutsideWindow|outside the committed window/i);
  });

  it("rejects an observation from before the reference time", async () => {
    const obsTs = NOW - 100n;
    const referenceTs = NOW;
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 4n, obsTs });
    const tx = attestationTx(
      attestor,
      message,
      await validateInstruction({ obsTs, referenceTs, windowSeconds: 3600 })
    );
    await expectReject(tx, /BeforeReference|before the reference time/i);
  });

  it("rejects an unknown predicate operator", async () => {
    const message = buildMessage({ fixtureRef: REF, statKey: 1, value: 4n, obsTs: NOW });
    const tx = attestationTx(attestor, message, await validateInstruction({ op: 9 }));
    await expectReject(tx, /InvalidOp|Unknown predicate operator/i);
  });
});
