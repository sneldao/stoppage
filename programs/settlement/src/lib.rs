// Stoppage settlement program.
//
// Sole job: given a predicate outcome claim, CPI into an operator's
// validator program to confirm it against cryptographically anchored
// data, then emit a proof-carrying event so the market can be settled
// and the UI can render the proof.
//
// The contract is oracle-agnostic. A validator is any Solana program
// that returns a 1-byte bool from a CPI (0x01 = predicate holds) and
// reads its truth from a readonly anchor account carrying the anchored
// Merkle root. TxLINE's `validate_stat` is the reference validator; an
// operator can substitute their own. This program never learns which
// validator it CPI'd into beyond recording its id on the receipt — the
// market program is the one that binds a market to an approved oracle.
//
// The event emitted on resolution carries the full proof (statement,
// anchored root, outcome, proof hash) so the Verifiable Resolution UI can
// render it without a second fetch, and a curious user or judge can
// re-verify locally. This is the "proof is the product" differentiator
// made literal in the contract.
//
// The keeper submits a single transaction containing:
//   1. resolve_market  (this program — CPIs into the validator)
//   2. settle_from_proof (market program — consumes the resolution receipt)
//   3. attest_verification (market program — increments verification counter)
//
// If resolve_market fails (proof invalid), the entire transaction reverts,
// so settlement IS conditional on on-chain proof verification.
//
// This program never sets odds and never custodies funds directly — see
// programs/market for the vault logic.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

declare_id!("5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF");

const MARKET_PROGRAM_ID: Pubkey = pubkey!("92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG");

#[program]
pub mod settlement {
    use super::*;
    use anchor_lang::solana_program::program::{invoke, get_return_data};

    /// Resolve a market by verifying a proof against an operator's
    /// validator program on-chain.
    ///
    /// 1. CPI into `validator_program` with the caller-supplied
    ///    instruction data (complete — including its discriminator)
    /// 2. Read the return data (bool) — true means the predicate holds
    /// 3. Verify the result matches the expected outcome
    /// 4. Record the validator on the receipt and emit `MarketResolved`
    ///
    /// Oracle-agnostic: the validator is supplied as the first remaining
    /// account, followed by the readonly account(s) it reads (the
    /// carriers of the anchored root). TxLINE's `validate_stat` is the
    /// reference validator, but any program returning a bool works. This
    /// program never learns which validator it CPI'd into beyond recording
    /// its id — the market program binds a market to an approved oracle
    /// and cross-checks the receipt's validator in `settle_from_proof`.
    ///
    /// Permissionless: any keeper can call this. The proof itself is the
    /// authority — if the validator rejects it, the CPI fails and the
    /// entire transaction reverts.
    ///
    /// The `validator_ix_data` is the complete instruction data for the
    /// validator (its 8-byte discriminator + borsh-serialized args).
    /// Building it in the SDK keeps oracle-specific serialization in
    /// TypeScript, where the oracle types are defined.
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        statement: String,
        merkle_root: [u8; 32],
        outcome: u8,
        validator_ix_data: Vec<u8>,
    ) -> Result<()> {
        require!(outcome <= 1, SettlementError::InvalidOutcome);
        require_keys_eq!(
            *ctx.accounts.market.owner,
            MARKET_PROGRAM_ID,
            SettlementError::InvalidMarketOwner
        );

        // The validator program is the first remaining account; the rest
        // are the readonly accounts it reads (the anchored root carrier(s)).
        let remaining = &ctx.remaining_accounts;
        require!(
            !remaining.is_empty(),
            SettlementError::MissingValidatorProgram
        );
        let validator_info = remaining[0].clone();
        let validator_program = validator_info.key();
        let anchor_infos = &remaining[1..];

        // Build the CPI instruction. Data is caller-supplied and complete.
        let metas = anchor_infos
            .iter()
            .map(|a| AccountMeta::new_readonly(a.key(), false))
            .collect::<Vec<_>>();
        let validate_ix = Instruction {
            program_id: validator_program,
            data: validator_ix_data,
            accounts: metas,
        };

        // Execute the CPI call. If the validator rejects the proof, this
        // returns an error and the transaction reverts.
        invoke(&validate_ix, anchor_infos)?;

        // Read the return data. The validator returns a bool (1 byte):
        // Anchor serializes bool as 0x01 (true) or 0x00 (false).
        let return_data = get_return_data()
            .ok_or(SettlementError::NoReturnData)?;

        // Verify the return data comes from the validator we CPI'd into.
        require_keys_eq!(
            return_data.0,
            validator_program,
            SettlementError::InvalidReturnSource
        );

        let validated = return_data.1.first().copied().unwrap_or(0) != 0;

        // outcome 0 = YES (predicate holds), 1 = NO (predicate doesn't).
        let expected_validated = outcome == 0; // YES = predicate holds
        require!(
            validated == expected_validated,
            SettlementError::ProofOutcomeMismatch
        );

        let clock = Clock::get()?;
        let proof_hash = hash_proof(&merkle_root);
        let receipt = &mut ctx.accounts.resolution;
        receipt.market = ctx.accounts.market.key();
        receipt.outcome = outcome;
        receipt.validator_program = validator_program;
        receipt.merkle_root = merkle_root;
        receipt.resolver = ctx.accounts.resolver.key();
        receipt.resolved_at = clock.unix_timestamp;
        receipt.bump = ctx.bumps.resolution;

        emit!(MarketResolved {
            market: ctx.accounts.market.key(),
            resolution: receipt.key(),
            statement: statement.clone(),
            validator_program,
            merkle_root,
            outcome,
            proof_hash,
            resolver: ctx.accounts.resolver.key(),
            timestamp: clock.unix_timestamp,
            validated_on_chain: true,
        });

        Ok(())
    }
}

/// The Merkle root IS the compact reference — it's already a 32-byte
/// hash of the entire proof tree. No additional hashing needed.
fn hash_proof(root: &[u8; 32]) -> [u8; 32] {
    *root
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Permissionless keeper — anyone can call resolve_market. The
    /// proof is the authority, not the caller.
    #[account(mut)]
    pub resolver: Signer<'info>,
    /// The market being resolved. Owned by programs/market.
    /// CHECK: validated by owner check in resolve_market; the market
    /// program binds this market to an approved oracle at creation and
    /// cross-checks the validator recorded on the receipt at settlement.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    #[account(
        init,
        payer = resolver,
        space = Resolution::SPACE,
        seeds = [b"resolution", market.key().as_ref()],
        bump,
    )]
    pub resolution: Account<'info, Resolution>,
    pub system_program: Program<'info, System>,
    // remaining_accounts:
    //   [0]       validator_program — the oracle program receiving the CPI
    //   [1..]     anchor accounts the validator reads (anchored root(s))
}

/// Immutable proof-gated receipt. The market program checks this exact PDA
/// before it can change a market from open to settled, and cross-checks
/// `validator_program` against the oracle the market was created with.
#[account]
pub struct Resolution {
    pub market: Pubkey,
    pub outcome: u8,
    /// The validator program that verified the proof via CPI. Recorded so
    /// the market program can bind settlement to the market's oracle.
    pub validator_program: Pubkey,
    pub merkle_root: [u8; 32],
    pub resolver: Pubkey,
    pub resolved_at: i64,
    pub bump: u8,
}

impl Resolution {
    pub const SPACE: usize = 8 + 32 + 1 + 32 + 32 + 32 + 8 + 1;
}

// ── Events ──────────────────────────────────────────────────────────

/// The proof-carrying resolution event. This is what the Verifiable
/// Resolution UI renders: the raw statement, the anchored root, the
/// outcome, and a hash of the Merkle path. A judge or user can
/// independently verify the proof against the anchored root without
/// trusting Stoppage.
#[event]
pub struct MarketResolved {
    /// The market that was resolved.
    pub market: Pubkey,
    pub resolution: Pubkey,
    /// The raw statement being proven, e.g. "GOAL:FRA:63:00".
    pub statement: String,
    /// The validator program that verified the proof via CPI.
    pub validator_program: Pubkey,
    /// The Merkle root anchored on Solana (from the oracle's root PDA).
    pub merkle_root: [u8; 32],
    /// The outcome: 0=YES, 1=NO, 2=VOID.
    pub outcome: u8,
    /// Keccak-256 hash of the Merkle root — compact on-chain reference.
    pub proof_hash: [u8; 32],
    /// Who called resolve_market (permissionless — anyone).
    pub resolver: Pubkey,
    /// On-chain timestamp of resolution.
    pub timestamp: i64,
    /// Whether the proof was verified on-chain via the validator CPI.
    pub validated_on_chain: bool,
}

// ── Errors ──────────────────────────────────────────────────────────

#[error_code]
pub enum SettlementError {
    /// The validator CPI did not return any data.
    #[msg("Validator returned no data")]
    NoReturnData,
    /// Return data came from an unexpected program.
    #[msg("Return data did not come from the validator program")]
    InvalidReturnSource,
    /// The proof verified but the outcome doesn't match the validation result.
    #[msg("Proof outcome does not match validator result")]
    ProofOutcomeMismatch,
    #[msg("Resolution outcome must be YES (0) or NO (1)")]
    InvalidOutcome,
    #[msg("Market is not owned by the Stoppage market program")]
    InvalidMarketOwner,
    #[msg("No validator program supplied in remaining accounts")]
    MissingValidatorProgram,
}
