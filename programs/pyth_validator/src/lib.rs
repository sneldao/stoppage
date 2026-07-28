// Stoppage Pyth validator — a price oracle for the proof-gated
// settlement primitive.
//
// This program plays the exact role TxLINE's `validate_stat` plays for
// sports markets: the settlement program CPIs into it with one readonly
// account (a Pyth PriceUpdateV2 posted to Solana via pyth-solana-receiver)
// and instruction data describing the claim; it returns a 1-byte bool
// (0x01 = predicate holds) as return data. Settlement is gated on that
// bool, so fund release for a price market is cryptographically tied to
// a Wormhole-verified Pyth observation in the same transaction.
//
// Semantics: "the Wormhole-verified aggregate price for `feed_id`, as
// published in the window [reference_ts, reference_ts + max_staleness],
// is >= threshold" (raw feed units, e.g. USD * 10^8 for SOL/USD).
// The market's closes_at is the reference_ts; the predicate answers
// "was the price above threshold at market close, with the observation
// bounded to max_staleness_seconds after close".
//
// What this guarantees: the CPI'd observation came from an account owned
// by the (immutable) Pyth receiver program, with the PriceUpdateV2
// discriminator — i.e. it is a guardian-verified price update posted
// on-chain by pyth-solana-receiver, not caller-supplied data. What it
// does NOT guarantee: epistemic truth of the Pyth price itself. That is
// the operator's oracle choice; the settlement primitive only guarantees
// the proof was verified atomically with fund release.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("73co8qb1DPiQP9zphReVNdsUPsHJZ5EoD3RpfKWUoQQG");

/// pyth-solana-receiver program (same address mainnet + devnet).
/// https://docs.pyth.network/price-feeds/core/contract-addresses/solana
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey =
    pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Anchor discriminator for the receiver's PriceUpdateV2 account:
/// sha256("account:PriceUpdateV2")[..8].
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// PriceUpdateV2 borsh layout (pyth-solana-receiver):
///   [0..8]    discriminator
///   [8..40]   write_authority: Pubkey
///   [40..]    verification_level: enum { Partial{num_signatures:u8}=0, Full=1 }
///   ..        price_message: PriceFeedMessage (76 bytes)
///   ..        posted_slot: u64
/// Minimum full length: 8 + 32 + 1 + 76 + 8 = 125 (Full); 126 for Partial.
const PRICE_UPDATE_V2_MIN_LEN: usize = 8 + 32 + 1 + 76 + 8;

#[program]
pub mod pyth_validator {
    use super::*;

    /// Verify a Pyth price observation against a threshold and return
    /// the result as a 1-byte bool in return data. Fails (reverts) on
    /// any structural or window violation.
    pub fn validate_price(
        ctx: Context<ValidatePrice>,
        feed_id: [u8; 32],
        threshold: i64,
        reference_ts: i64,
        max_staleness_seconds: u32,
    ) -> Result<()> {
        let info = &ctx.accounts.price_update;
        require!(
            *info.owner == PYTH_RECEIVER_PROGRAM_ID,
            ValidatorError::NotPythReceiverAccount
        );
        let data = info.try_borrow_data()?;
        require!(
            data.len() >= PRICE_UPDATE_V2_MIN_LEN,
            ValidatorError::MalformedUpdate
        );
        require!(
            data[0..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
            ValidatorError::MalformedUpdate
        );

        let mut off = 8 + 32; // discriminator + write_authority
        let variant = data[off];
        require!(variant <= 1, ValidatorError::MalformedUpdate);
        // Partial carries a u8 num_signatures payload; Full carries none.
        off += if variant == 0 { 2 } else { 1 };

        // PriceFeedMessage
        let msg_feed: [u8; 32] = data[off..off + 32].try_into().unwrap();
        require!(msg_feed == feed_id, ValidatorError::FeedMismatch);
        let price = i64::from_le_bytes(data[off + 32..off + 40].try_into().unwrap());
        let publish_time = i64::from_le_bytes(data[off + 52..off + 60].try_into().unwrap());

        // The observation must be the first post-close price, bounded
        // by the staleness window. A publish before the reference time
        // answers the wrong question; one too far after admits drift.
        let upper = reference_ts
            .checked_add(max_staleness_seconds as i64)
            .ok_or(ValidatorError::Overflow)?;
        require!(publish_time >= reference_ts, ValidatorError::BeforeReference);
        require!(publish_time <= upper, ValidatorError::OutsideWindow);

        let holds = price >= threshold;
        set_return_data(&[holds as u8]);
        msg!(
            "validate_price price={} threshold={} publish_time={} -> {}",
            price,
            threshold,
            publish_time,
            holds
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ValidatePrice<'info> {
    /// The Pyth PriceUpdateV2 account posted by pyth-solana-receiver.
    /// CHECK: owner, discriminator, feed id, and time window are all
    /// validated in `validate_price`.
    pub price_update: UncheckedAccount<'info>,
}

#[error_code]
pub enum ValidatorError {
    #[msg("Account is not owned by the Pyth receiver program")]
    NotPythReceiverAccount,
    #[msg("Account data is not a well-formed PriceUpdateV2")]
    MalformedUpdate,
    #[msg("Observation feed id does not match the claimed feed")]
    FeedMismatch,
    #[msg("Observation was published before the reference time")]
    BeforeReference,
    #[msg("Observation is outside the staleness window")]
    OutsideWindow,
    #[msg("Arithmetic overflow")]
    Overflow,
}
