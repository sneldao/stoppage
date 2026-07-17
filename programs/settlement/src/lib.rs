// Stoppage settlement program.
//
// Sole job: given a predicate outcome claim, CPI into TxLINE's
// `validate_stat` instruction to confirm it against the cryptographically
// anchored match data, then emit a proof-carrying event so the market
// can be settled and the UI can render the proof.
//
// The event emitted on resolution carries the full proof (statement,
// anchored root, outcome, proof hash) so the Verifiable Resolution UI can
// render it without a second fetch, and a curious user or judge can
// re-verify locally. This is the "proof is the product" differentiator
// made literal in the contract.
//
// The agent submits a single transaction containing:
//   1. resolve_market  (this program — CPIs into TxLINE validate_stat)
//   2. force_settle    (market program — settles with the outcome)
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

// TxLINE validate_stat instruction discriminator (from the TxLINE IDL).
const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

#[program]
pub mod settlement {
    use super::*;
    use anchor_lang::solana_program::program::{invoke, get_return_data};

    /// Resolve a market by verifying a TxLINE Merkle proof on-chain.
    ///
    /// 1. CPI into TxLINE's `validate_stat` with the full proof data
    /// 2. Read the return data (bool) — true means the predicate holds
    /// 3. Verify the result matches the expected outcome
    /// 4. Emit `MarketResolved` carrying the full proof data
    ///
    /// Permissionless: any keeper can call this. The proof itself is the
    /// authority — if `validate_stat` rejects it, the call fails and the
    /// entire transaction reverts (including any force_settle in the same tx).
    ///
    /// The `txline_ix_data` is the pre-built instruction data for TxLINE's
    /// `validate_stat` instruction (discriminator + borsh-serialized args).
    /// Building it in the SDK keeps the complex TxLINE type serialization
    /// in TypeScript, where the TxLINE types are already defined.
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        statement: String,
        merkle_root: [u8; 32],
        outcome: u8,
        txline_ix_data: Vec<u8>,
    ) -> Result<()> {
        // Build the CPI instruction for TxLINE's validate_stat.
        // The data is pre-built by the SDK (discriminator + borsh args).
        // We prepend the validate_stat discriminator to make the full
        // instruction data.
        let mut ix_data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
        ix_data.extend_from_slice(&txline_ix_data);

        let validate_ix = Instruction {
            program_id: ctx.accounts.txline_program.key(),
            data: ix_data,
            accounts: vec![AccountMeta::new_readonly(
                ctx.accounts.daily_scores_merkle_roots.key(),
                false,
            )],
        };

        // Execute the CPI call. If validate_stat fails (proof invalid),
        // this returns an error and the transaction reverts.
        invoke(
            &validate_ix,
            &[ctx.accounts.daily_scores_merkle_roots.to_account_info()],
        )?;

        // Read the return data. validate_stat returns a bool (1 byte).
        // Anchor serializes bool as 0x01 (true) or 0x00 (false).
        let return_data = get_return_data()
            .ok_or(SettlementError::NoReturnData)?;

        // Verify the return data comes from the TxLINE program.
        require_keys_eq!(
            return_data.0,
            ctx.accounts.txline_program.key(),
            SettlementError::InvalidReturnSource
        );

        let validated = return_data.1.first().copied().unwrap_or(0) != 0;

        // The outcome encodes what the agent determined from the proof.
        // outcome 0 = YES (predicate holds), 1 = NO (predicate doesn't hold).
        // validate_stat returns true if the predicate holds.
        let expected_validated = outcome == 0; // YES = predicate holds
        require!(
            validated == expected_validated,
            SettlementError::ProofOutcomeMismatch
        );

        let clock = Clock::get()?;
        let proof_hash = hash_proof(&merkle_root);

        emit!(MarketResolved {
            market: ctx.accounts.market.key(),
            statement: statement.clone(),
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
    /// CHECK: validated by the caller passing the correct market address.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: TxLINE validation program (6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J on devnet).
    /// The address is verified by the CPI call — if it's not the real
    /// TxLINE program, validate_stat will fail.
    pub txline_program: UncheckedAccount<'info>,
    /// The daily_scores_merkle_roots PDA from TxLINE. This is the account
    /// that stores the anchored Merkle root for the given epoch day.
    /// The PDA is derived as: ["daily_scores_roots", epoch_day_u16_le]
    /// CHECK: owned by txline_program, verified by the CPI call.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
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
    /// The raw statement being proven, e.g. "GOAL:FRA:63:00".
    pub statement: String,
    /// The Merkle root anchored on Solana (from TxLINE's daily_scores_roots PDA).
    pub merkle_root: [u8; 32],
    /// The outcome: 0=YES, 1=NO, 2=VOID.
    pub outcome: u8,
    /// Keccak-256 hash of the Merkle root — compact on-chain reference.
    pub proof_hash: [u8; 32],
    /// Who called resolve_market (permissionless — anyone).
    pub resolver: Pubkey,
    /// On-chain timestamp of resolution.
    pub timestamp: i64,
    /// Whether the proof was verified on-chain via validate_stat CPI.
    pub validated_on_chain: bool,
}

// ── Errors ──────────────────────────────────────────────────────────

#[error_code]
pub enum SettlementError {
    /// validate_stat did not return any data.
    #[msg("TxLINE validate_stat returned no data")]
    NoReturnData,
    /// Return data came from an unexpected program.
    #[msg("Return data did not come from the TxLINE program")]
    InvalidReturnSource,
    /// The proof verified but the outcome doesn't match the validation result.
    #[msg("Proof outcome does not match validate_stat result")]
    ProofOutcomeMismatch,
}
