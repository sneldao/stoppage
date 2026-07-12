// Stoppage settlement program — skeleton.
//
// Sole job: given a predicate outcome claim, CPI into TxLINE's
// `validate_stat` instruction to confirm it against the cryptographically
// anchored match data, then flip the corresponding market's status so the
// market program will release funds on claim().
//
// This program never sets odds and never custodies funds directly — see
// programs/market for the vault logic.

use anchor_lang::prelude::*;

declare_id!("5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF");

#[program]
pub mod settlement {
    use super::*;

    pub fn resolve_market(
        _ctx: Context<ResolveMarket>,
        _statement: String,
        _merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        // TODO:
        //  1. CPI into TxLINE's validate_stat with (statement, merkle_proof)
        //  2. On success, write outcome + verified proof reference to the
        //     market's state account (owned by programs/market)
        //  3. Emit an event carrying the proof so the Verifiable
        //     Resolution UI can display it without a second fetch
        todo!()
    }
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>, // can be a permissionless keeper
    /// CHECK: TxLINE validation program, address TBD from their docs
    pub txline_program: UncheckedAccount<'info>,
}
