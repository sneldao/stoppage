// Stoppage market program — skeleton.
//
// Responsibilities:
//   - create_market: initialize a vault PDA for a given predicate
//   - join: deposit stake into the vault on a chosen side, from either
//     the owner wallet OR an authorized session key
//   - claim: after the settlement program marks a market settled, release
//     funds to winning positions
//
// Deliberately NOT responsible for: evaluating predicates, verifying
// TxLINE proofs, or setting odds. That lives in `programs/settlement`
// and the off-chain resolver. Keep this program's surface area small.

use anchor_lang::prelude::*;

declare_id!("Stoppage111111111111111111111111111111111");

#[program]
pub mod market {
    use super::*;

    pub fn create_market(_ctx: Context<CreateMarket>) -> Result<()> {
        // TODO: initialize vault PDA + market state account
        todo!()
    }

    pub fn join(_ctx: Context<Join>, _side: u8, _amount: u64) -> Result<()> {
        // TODO: transfer stake into vault, record Position
        // Accept a signer that is either the owner wallet or a session
        // key previously delegated and validated against on-chain grant.
        todo!()
    }

    pub fn claim(_ctx: Context<Claim>) -> Result<()> {
        // TODO: require market.status == Settled (set by settlement
        // program via CPI), then release vault funds per outcome.
        todo!()
    }
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub signer: Signer<'info>, // owner wallet OR session key
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
}
