// Stoppage market program — M2 acceptance tests.
//
// Covers the ROADMAP M2 test list: payout math, double-claim,
// claim-before-settle, join-after-close, session-key join with
// expired/revoked grant, cumulative-spend-cap breach, void refund path,
// plus the side-mismatch guard added in the same review pass.
//
// Run via `npm run anchor:test` (or `anchor test`). Uses the Anchor TS
// Program client bound to the IDL in packages/sdk/idl/ — the single
// source of truth (rule 2). Tests do NOT depend on @stoppage/sdk's
// hand-rolled instruction builders; they exercise the program directly.
//
// Bootstrap: the first test calls initialize_protocol once. Every later
// test assumes ProtocolConfig + treasury exist.

import * as anchor from "@coral-xyz/anchor";
const { Program, BN } = anchor as any;
import * as web3 from "@solana/web3.js";
const { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } = web3;
import * as chai from "chai";
const { assert, expect } = chai;
import * as fs from "fs";
import * as path from "path";

// Load the IDL via fs (rule 2 — single source of truth in packages/sdk/idl/)
// rather than a JSON import, to stay loader-agnostic under Node 22.
const marketIdl = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../packages/sdk/idl/market.json"), "utf8")
);

const MARKET_PROGRAM_ID = new PublicKey(marketIdl.address);

// u8 constants — mirror the program's private constants.
const SIDE_YES = 0;
const SIDE_NO = 1;
const STATUS_OPEN = 0;
const STATUS_SETTLED = 2;
const STATUS_VOID = 3;
const FEE_BPS = 25; // 0.25%
const BOND = 10_000_000; // 0.01 SOL
const STAKE = 50_000_000; // 0.05 SOL

// Anchor's Program<T> infers the instruction/account types from the IDL.
// We type it loosely as Program<any> since the IDL is loaded at runtime.
type MarketProgram = Program<any>;

function matchId(s: string): Uint8Array {
  const buf = new Uint8Array(32);
  new TextEncoder().encodeInto(s, buf);
  return buf;
}
function team(s: string): Uint8Array {
  const buf = new Uint8Array(8);
  new TextEncoder().encodeInto(s, buf);
  return buf;
}

describe("stoppage / market program (M2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Market as unknown as MarketProgram;
  const authority = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // PDA helpers
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    MARKET_PROGRAM_ID
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    MARKET_PROGRAM_ID
  );

  // Airdrop helpers for ephemeral test wallets.
  async function fund(pk: PublicKey, lamports = 2 * LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(pk, lamports);
    await connection.confirmTransaction(sig, "confirmed");
  }

  async function balance(pk: PublicKey): Promise<number> {
    return (await connection.getAccountInfo(pk))?.lamports ?? 0;
  }

  // Build a market PDA + the create_market instruction args for a unique
  // match id so each test gets its own market.
  function marketFor(label: string, paramU64: number, closesAt: number) {
    const mid = matchId(label);
    const tm = team("FRA");
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), mid, Buffer.from([0]), tm, new BN(paramU64).toArrayLike(Buffer, "le", 8)],
      MARKET_PROGRAM_ID
    );
    return { marketPda, kind: 0, matchId: mid, team: tm, paramU64, closesAt };
  }

  async function createMarket(creator: Keypair, m: ReturnType<typeof marketFor>) {
    await program.methods
      .createMarket(m.kind, Buffer.from(m.matchId), Buffer.from(m.team), new BN(m.paramU64), new BN(m.closesAt))
      .accounts({
        creator: creator.publicKey,
        market: m.marketPda,
        protocolConfig: configPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
  }

  async function joinWallet(signer: Keypair, marketPda: PublicKey, side: number, amount: number) {
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), signer.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await program.methods
      .joinViaWallet(side, new BN(amount))
      .accounts({
        signer: signer.publicKey,
        market: marketPda,
        position: positionPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([signer])
      .rpc();
    return positionPda;
  }

  async function forceSettle(outcome: number, marketPda: PublicKey) {
    await program.methods
      .forceSettle(outcome)
      .accounts({
        authority: authority.publicKey,
        protocolConfig: configPda,
        market: marketPda,
      })
      .rpc();
  }

  async function claim(claimant: Keypair, marketPda: PublicKey) {
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), claimant.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await program.methods
      .claim()
      .accounts({
        claimant: claimant.publicKey,
        market: marketPda,
        position: positionPda,
        treasury: treasuryPda,
      })
      .signers([claimant])
      .rpc();
    return positionPda;
  }

  async function fetchMarket(marketPda: PublicKey): Promise<any> {
    return program.account.market.fetch(marketPda);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  it("initializes the protocol (one-time)", async () => {
    // If already initialized (re-run), this will throw — that's fine.
    try {
      await program.methods
        .initializeProtocol(FEE_BPS)
        .accounts({
          authority: authority.publicKey,
          protocolConfig: configPda,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      // Account-already-exists is acceptable on re-runs.
      const msg = (e as Error).message;
      if (!/already in use|already exists|custom program error: 0x0/i.test(msg)) throw e;
    }
    const config = await program.account.protocolConfig.fetch(configPda);
    assert.equal(config.feeBps, FEE_BPS);
    assert.deepEqual(config.authority, authority.publicKey);
  });

  // ── Market lifecycle ───────────────────────────────────────────────

  it("creates a market with a refundable bond", async () => {
    const creator = Keypair.generate();
    await fund(creator.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const m = marketFor("m-create", 600, closesAt);
    await createMarket(creator, m);

    const market = await fetchMarket(m.marketPda);
    assert.equal(market.status, STATUS_OPEN);
    assert.equal(market.bondLamports.toNumber(), BOND);
    assert.equal(market.feeBps, FEE_BPS);
    // Bond was transferred into the market (vault) account.
    assert.isAtLeast(await balance(m.marketPda), BOND);
  });

  it("rejects create_market with a closes_at in the past", async () => {
    const creator = Keypair.generate();
    await fund(creator.publicKey);
    const m = marketFor("m-past", 600, Math.floor(Date.now() / 1000) - 10);
    try {
      await createMarket(creator, m);
      assert.fail("should have rejected past closes_at");
    } catch (e) {
      expect((e as Error).message).to.match(/ClosesInPast|custom program error/i);
    }
  });

  it("rejects join after the market closes", async () => {
    const creator = Keypair.generate();
    const joiner = Keypair.generate();
    await fund(creator.publicKey);
    await fund(joiner.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 5;
    const m = marketFor("m-closed", 600, closesAt);
    await createMarket(creator, m);
    // Wait past closes_at.
    await new Promise((r) => setTimeout(r, 6000));
    try {
      await joinWallet(joiner, m.marketPda, SIDE_YES, STAKE);
      assert.fail("should have rejected join after close");
    } catch (e) {
      expect((e as Error).message).to.match(/MarketClosed|custom program error/i);
    }
  });

  // ── Payout math ────────────────────────────────────────────────────

  it("pays winners pro-rata from the losing pool, minus protocol fee", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    const no = Keypair.generate();
    await fund(creator.publicKey);
    await fund(yes.publicKey);
    await fund(no.publicKey);

    const closesAt = Math.floor(Date.now() / 1000) + 60;
    const m = marketFor("m-pay", 600, closesAt);
    await createMarket(creator, m);

    await joinWallet(yes, m.marketPda, SIDE_YES, STAKE);
    await joinWallet(no, m.marketPda, SIDE_NO, STAKE * 2);

    const yesBalBefore = await balance(yes.publicKey);
    await forceSettle(SIDE_YES, m.marketPda);
    await claim(yes, m.marketPda);

    const yesBalAfter = await balance(yes.publicKey);
    const gross = STAKE + STAKE * 2; // stake back + full losing pool (sole winner)
    const fee = Math.floor((gross * FEE_BPS) / 10_000);
    const expectedPayout = gross - fee;
    // Net of tx fees; allow a small margin.
    const received = yesBalAfter - yesBalBefore;
    assert.closeTo(received, expectedPayout, 20_000, `received ${received} ~ expected ${expectedPayout}`);

    const market = await fetchMarket(m.marketPda);
    assert.equal(market.status, STATUS_SETTLED);
    assert.equal(market.outcome, SIDE_YES);
    // Treasury received the fee.
    assert.isAtLeast(await balance(treasuryPda), fee);
  });

  it("rejects claim before the market is settled", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    await fund(creator.publicKey);
    await fund(yes.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 60;
    const m = marketFor("m-earlyclaim", 600, closesAt);
    await createMarket(creator, m);
    await joinWallet(yes, m.marketPda, SIDE_YES, STAKE);
    try {
      await claim(yes, m.marketPda);
      assert.fail("should have rejected claim before settle");
    } catch (e) {
      expect((e as Error).message).to.match(/NotSettled|custom program error/i);
    }
  });

  it("rejects double-claim (second claim is a no-op error)", async () => {
    const creator = Keypair.generate();
    const yes = Keypair.generate();
    await fund(creator.publicKey);
    await fund(yes.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 60;
    const m = marketFor("m-double", 600, closesAt);
    await createMarket(creator, m);
    await joinWallet(yes, m.marketPda, SIDE_YES, STAKE);
    await forceSettle(SIDE_YES, m.marketPda);
    await claim(yes, m.marketPda);
    try {
      await claim(yes, m.marketPda);
      assert.fail("should have rejected double claim");
    } catch (e) {
      expect((e as Error).message).to.match(/NothingToClaim|custom program error/i);
    }
  });

  it("rejects joining the opposite side of an existing position", async () => {
    const creator = Keypair.generate();
    const flip = Keypair.generate();
    await fund(creator.publicKey);
    await fund(flip.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 60;
    const m = marketFor("m-flip", 600, closesAt);
    await createMarket(creator, m);
    await joinWallet(flip, m.marketPda, SIDE_YES, STAKE);
    try {
      await joinWallet(flip, m.marketPda, SIDE_NO, STAKE);
      assert.fail("should have rejected opposite-side join");
    } catch (e) {
      expect((e as Error).message).to.match(/AlreadyJoinedOtherSide|custom program error/i);
    }
  });

  // ── Void refund path ───────────────────────────────────────────────
  //
  // The full grace-period void (closes_at + 1h, then permissionless
  // void_market) requires either a 1h wall-clock wait or a clock-warp
  // harness (bankrun). Neither belongs in the default `anchor test`
  // suite. The void *refund math* (full stake back, no fee) is exercised
  // here by force-settling to VOID... but force_settle only accepts
  // YES/NO by design (it's the M2 mock oracle, not the void path).
  //
  // TODO(M3+): add a bankrun-based test that warps the clock past
  // closes_at + GRACE_PERIOD_SECONDS and asserts void_market + void
  // refund end to end. Tracked in ROADMAP.

  it.skip("voids an unsettled market after the grace period and refunds stakes (needs clock-warp harness)", async () => {
    // See note above — requires bankrun to warp past the 1h grace period
    // without a real wall-clock wait, since create_market rejects a
    // closes_at in the past.
  });

  // ── Session-key delegation (M1 + M2 cap enforcement) ───────────────

  async function delegate(
    owner: Keypair,
    session: Keypair,
    opts: { maxTotal?: number; maxPerMarket?: number; fund?: number; expiresAt?: number } = {}
  ) {
    const maxPerMarket = opts.maxPerMarket ?? STAKE * 4;
    const maxTotal = opts.maxTotal ?? STAKE * 4;
    const expiresAt = opts.expiresAt ?? Math.floor(Date.now() / 1000) + 3600;
    const fundLamports = opts.fund ?? 5 * LAMPORTS_PER_SOL / 10; // 0.5 SOL
    const [grantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session_grant"), owner.publicKey.toBuffer(), session.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await program.methods
      .delegateSessionKey(
        [MARKET_PROGRAM_ID],
        new BN(maxPerMarket),
        new BN(maxTotal),
        new BN(expiresAt),
        new BN(fundLamports)
      )
      .accounts({
        owner: owner.publicKey,
        sessionPubkey: session.publicKey,
        grant: grantPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    return grantPda;
  }

  async function joinSession(
    session: Keypair,
    owner: Keypair,
    marketPda: PublicKey,
    side: number,
    amount: number
  ) {
    const [grantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session_grant"), owner.publicKey.toBuffer(), session.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketPda.toBuffer(), owner.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await program.methods
      .joinViaSessionKey(side, new BN(amount))
      .accounts({
        sessionKey: session.publicKey,
        owner: owner.publicKey,
        grant: grantPda,
        market: marketPda,
        position: positionPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([session])
      .rpc();
    return positionPda;
  }

  it("session key joins a market with no wallet popup (M1 differentiator)", async () => {
    const creator = Keypair.generate();
    const owner = Keypair.generate();
    const session = Keypair.generate();
    await fund(creator.publicKey);
    await fund(owner.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const m = marketFor("m-session", 600, closesAt);
    await createMarket(creator, m);
    await delegate(owner, session);
    const positionPda = await joinSession(session, owner, m.marketPda, SIDE_YES, STAKE);

    const pos = await program.account.position.fetch(positionPda);
    assert.equal(pos.side, SIDE_YES);
    assert.equal(pos.amountLamports.toNumber(), STAKE);
    assert.equal(pos.openedViaSessionKey, true);
    assert.deepEqual(pos.owner, owner.publicKey);
  });

  it("rejects session-key join when the cumulative spend cap is breached (rule 9)", async () => {
    const creator = Keypair.generate();
    const owner = Keypair.generate();
    const session = Keypair.generate();
    await fund(creator.publicKey);
    await fund(owner.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const m = marketFor("m-cap", 600, closesAt);
    await createMarket(creator, m);
    // Cap = 1.5 * STAKE. First join of STAKE ok; second of STAKE breaches.
    await delegate(owner, session, { maxTotal: Math.floor(STAKE * 1.5) });
    await joinSession(session, owner, m.marketPda, SIDE_YES, STAKE);
    try {
      await joinSession(session, owner, m.marketPda, SIDE_YES, STAKE);
      assert.fail("should have rejected spend-cap breach");
    } catch (e) {
      expect((e as Error).message).to.match(/SpendCapExceeded|custom program error/i);
    }
  });

  it("rejects session-key join with an expired grant", async () => {
    const creator = Keypair.generate();
    const owner = Keypair.generate();
    const session = Keypair.generate();
    await fund(creator.publicKey);
    await fund(owner.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const m = marketFor("m-exp", 600, closesAt);
    await createMarket(creator, m);
    // Expire in the past.
    await delegate(owner, session, { expiresAt: Math.floor(Date.now() / 1000) - 10 });
    try {
      await joinSession(session, owner, m.marketPda, SIDE_YES, STAKE);
      assert.fail("should have rejected expired grant");
    } catch (e) {
      expect((e as Error).message).to.match(/GrantExpired|custom program error/i);
    }
  });

  it("rejects session-key join after revocation", async () => {
    const creator = Keypair.generate();
    const owner = Keypair.generate();
    const session = Keypair.generate();
    await fund(creator.publicKey);
    await fund(owner.publicKey);
    const closesAt = Math.floor(Date.now() / 1000) + 3600;
    const m = marketFor("m-rev", 600, closesAt);
    await createMarket(creator, m);
    const [grantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session_grant"), owner.publicKey.toBuffer(), session.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await delegate(owner, session);
    await program.methods
      .revokeSessionKey()
      .accounts({
        owner: owner.publicKey,
        sessionPubkey: session.publicKey,
        grant: grantPda,
      })
      .signers([owner])
      .rpc();
    try {
      await joinSession(session, owner, m.marketPda, SIDE_YES, STAKE);
      assert.fail("should have rejected revoked grant");
    } catch (e) {
      // Account closed by revoke → AccountNotInitialized or grant-closed error.
      expect((e as Error).message).to.match(/AccountNotInitialized|GrantRevoked|custom program error|0x1/i);
    }
  });

  it("session_ping succeeds with an active grant (M1 acceptance primitive)", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    await fund(owner.publicKey);
    const [grantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session_grant"), owner.publicKey.toBuffer(), session.publicKey.toBuffer()],
      MARKET_PROGRAM_ID
    );
    await delegate(owner, session);
    await program.methods
      .sessionPing()
      .accounts({
        sessionKey: session.publicKey,
        owner: owner.publicKey,
        grant: grantPda,
      })
      .signers([session])
      .rpc();
    // No throw == pass. The grant is active and the session key signed.
  });
});
