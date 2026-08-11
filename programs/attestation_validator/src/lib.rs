// Stoppage attestation validator — an operator-attested oracle for the
// proof-gated settlement primitive.
//
// This program plays the exact role TxLINE's `validate_stat` (and our
// `pyth_validator`'s `validate_price`) play for their data sources: the
// settlement program CPIs into it describing the claim; it returns a
// 1-byte bool (0x01 = predicate holds) as return data. Settlement is
// gated on that bool, so fund release is cryptographically tied to an
// ed25519-precompile-verified operator attestation in the same
// transaction.
//
// Trust model (read before reusing): the observation is NOT verified by
// an external network (TxODDS's Merkle pipeline, Pyth's guardians). It
// is signed by ONE operator key, pinned on-chain in the Config PDA. This
// is the reference implementation of "operators bring their own
// oracles" (see docs/OPERATORS.md): the settlement primitive guarantees
// the attestation was verified ATOMICALLY with fund release, from a key
// the market creator chose — nothing more. Epistemic truth of the
// observation remains the operator's responsibility.
//
// Verification mechanics: the operator signs the observation message
//     b"stoppage/attest-observation/v1"
//     || fixture_ref[16] || stat_key(u32 LE) || value(i64 LE) || obs_ts(i64 LE)
// with the Config authority key and submits the bundle as ONE
// transaction whose top-level instructions are:
//     ix[k-1] = ed25519 precompile (verifies sig over that message)
//     ix[k]   = settlement.resolve_market (CPIs into this program)
// The validator reads the instructions sysvar, locates the preceding
// top-level instruction, and requires it to be the ed25519 precompile
// with self-referential offsets (signature, pubkey, and message all
// inside that same instruction), with the pubkey == Config.authority
// and the message byte-equal to the claim argued here. The precompile
// itself performing the cryptographic check is what makes the
// observation unforgeable; this program binds it to the exact claim.
//
// Replay reasoning: a valid (authority, message) pair can only attest
// the observation it genuinely signs. Re-using it elsewhere is bounded
// by the claim arguments themselves (fixture_ref, stat_key, value,
// obs_ts) and by the [reference_ts, reference_ts + window_seconds]
// window a market commits to at creation; a stale observation cannot
// answer a new claim window. consume-once semantics come from the
// market program (a market resolves once), as with every oracle.
//
// Predicate semantics: `op` compares the observed `value` against the
// market's `threshold` (0 = >=, 1 = <=, 2 = ==). Fractional lines
// (e.g. "over 2.5 goals") are mapped by the caller to integer form
// (value >= 3). `stat_key` is opaque to this program — it is bound
// into the signed message, never interpreted; its scale registry lives
// in the agent's attestation source module (one source of truth).
//
// What this guarantees: fund release in this transaction required an
// ed25519-verified message from the on-chain-pinned authority, matching
// the exact statistic, value, and time window claimed. What it does
// NOT guarantee: that the operator's observation reflects reality.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;

declare_id!("CJ5VvvWqFeP6MfNyyDPvZ3kNNj4h1bbQrv1iQsPF4TDp");

/// Domain-separating prefix of the signed observation message. The full
/// message is 30 + 16 + 4 + 8 + 8 = 66 bytes.
pub const MSG_PREFIX: &[u8; 30] = b"stoppage/attest-observation/v1";
pub const MSG_LEN: usize = 30 + 16 + 4 + 8 + 8;

/// Predicate comparison operators for `validate_attestation`.
pub const OP_GTE: u8 = 0;
pub const OP_LTE: u8 = 1;
pub const OP_EQ: u8 = 2;

/// The ed25519 signature-verification precompile.
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

#[program]
pub mod attestation_validator {
    use super::*;

    /// One-time init of the Config PDA pinning the operator authority
    /// whose ed25519 signatures this validator accepts. Permissionless,
    /// first-init-wins (devnet reference implementation; an operator
    /// deploying their own would init this themselves).
    pub fn initialize_config(ctx: Context<InitializeConfig>, authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = authority;
        msg!("attestation_validator config initialized, authority={}", authority);
        Ok(())
    }

    /// Verify an operator-signed observation against the claimed
    /// predicate and return the result as a 1-byte bool in return data.
    /// Fails (reverts) on any binding or window violation.
    ///
    /// `reference_ts`/`window_seconds` bound the observation to
    /// [reference_ts, reference_ts + window_seconds] — for match-end
    /// predicates, reference is the scheduled full-time; the window
    /// stops a stale observation answering a fresh claim.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_attestation(
        ctx: Context<ValidateAttestation>,
        fixture_ref: [u8; 16],
        stat_key: u32,
        op: u8,
        threshold: i64,
        value: i64,
        obs_ts: i64,
        reference_ts: i64,
        window_seconds: u32,
    ) -> Result<()> {
        // ── Bind the signature: the preceding top-level instruction
        // must be the ed25519 precompile, self-contained, signed by the
        // pinned authority, over exactly the claimed message. ────────
        let ixns = &ctx.accounts.instructions;
        require_keys_eq!(
            ixns.key(),
            sysvar_instructions::ID,
            ValidatorError::MissingInstructionsSysvar
        );
        let current = sysvar_instructions::load_current_index_checked(ixns)
            .map_err(|_| ValidatorError::MissingEd25519Instruction)? as usize;
        require!(current > 0, ValidatorError::MissingEd25519Instruction);
        let pre = sysvar_instructions::load_instruction_at_checked(current - 1, ixns)
            .map_err(|_| ValidatorError::MissingEd25519Instruction)?;
        require!(
            pre.program_id == ED25519_PROGRAM_ID,
            ValidatorError::MissingEd25519Instruction
        );

        // Ed25519 precompile instruction layout (self-contained form):
        //   [0]        num_signatures (must be 1)
        //   [1]        padding
        //   [2..16]    7 x u16 LE offsets: sig/pk/msg + their ix indices
        //   [16..]     signature(64) || pubkey(32) || message
        let d = &pre.data;
        require!(d.len() >= 16, ValidatorError::MalformedSigIx);
        require!(d[0] == 1, ValidatorError::MalformedSigIx);
        let sig_ix = u16::from_le_bytes([d[4], d[5]]);
        let pk_off = u16::from_le_bytes([d[6], d[7]]) as usize;
        let pk_ix = u16::from_le_bytes([d[8], d[9]]);
        let msg_off = u16::from_le_bytes([d[10], d[11]]) as usize;
        let msg_size = u16::from_le_bytes([d[12], d[13]]) as usize;
        let msg_ix = u16::from_le_bytes([d[14], d[15]]);
        // u16::MAX = "this instruction" — sig, key, and message must all
        // live inside the precompile instruction itself, so no other
        // instruction's data can be spliced into the verification.
        require!(
            sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
            ValidatorError::CrossInstructionReference
        );
        require!(msg_size == MSG_LEN, ValidatorError::MessageMismatch);
        require!(
            d.len() >= pk_off + 32 && d.len() >= msg_off + msg_size,
            ValidatorError::MalformedSigIx
        );
        require!(
            d[pk_off..pk_off + 32] == ctx.accounts.config.authority.to_bytes(),
            ValidatorError::SignerMismatch
        );

        let mut expected = Vec::with_capacity(MSG_LEN);
        expected.extend_from_slice(MSG_PREFIX);
        expected.extend_from_slice(&fixture_ref);
        expected.extend_from_slice(&stat_key.to_le_bytes());
        expected.extend_from_slice(&value.to_le_bytes());
        expected.extend_from_slice(&obs_ts.to_le_bytes());
        require!(
            d[msg_off..msg_off + msg_size] == expected[..],
            ValidatorError::MessageMismatch
        );

        // ── Time window: the observation must be at/after the
        // reference and within the committed window. ─────────────────
        let upper = reference_ts
            .checked_add(window_seconds as i64)
            .ok_or(ValidatorError::Overflow)?;
        require!(obs_ts >= reference_ts, ValidatorError::BeforeReference);
        require!(obs_ts <= upper, ValidatorError::OutsideWindow);

        // ── Predicate over the (now-bound) observed value. ──────────
        let holds = match op {
            OP_GTE => value >= threshold,
            OP_LTE => value <= threshold,
            OP_EQ => value == threshold,
            _ => return err!(ValidatorError::InvalidOp),
        };
        set_return_data(&[holds as u8]);
        msg!(
            "validate_attestation stat_key={} value={} op={} threshold={} obs_ts={} -> {}",
            stat_key,
            value,
            op,
            threshold,
            obs_ts,
            holds
        );
        Ok(())
    }
}

#[account]
pub struct Config {
    /// The operator key whose ed25519-precompile-verified observations
    /// this validator accepts.
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = payer, space = 8 + 32, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateAttestation<'info> {
    /// The Config PDA carrying the pinned authority. Anchor checks
    /// owner + discriminator; seeds pin it to the canonical PDA.
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: the instructions sysvar; address-checked in the handler.
    pub instructions: UncheckedAccount<'info>,
}

#[error_code]
pub enum ValidatorError {
    #[msg("Instructions account is not the instructions sysvar")]
    MissingInstructionsSysvar,
    #[msg("Preceding instruction is not the ed25519 precompile")]
    MissingEd25519Instruction,
    #[msg("Ed25519 precompile instruction is malformed")]
    MalformedSigIx,
    #[msg("Ed25519 verification must be self-contained in one instruction")]
    CrossInstructionReference,
    #[msg("Signer is not the pinned attestation authority")]
    SignerMismatch,
    #[msg("Signed message does not match the claimed observation")]
    MessageMismatch,
    #[msg("Observation timestamp is before the reference time")]
    BeforeReference,
    #[msg("Observation is outside the committed window")]
    OutsideWindow,
    #[msg("Unknown predicate operator")]
    InvalidOp,
    #[msg("Arithmetic overflow")]
    Overflow,
}
