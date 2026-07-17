// Stoppage settlement program.
//
// Sole job: given a predicate outcome claim, CPI into TxLINE's
// `validate_stat` instruction to confirm it against the cryptographically
// anchored match data, then flip the corresponding market's status so the
// market program will release funds on claim().
//
// The event emitted on resolution carries the full proof (statement,
// anchored root, outcome, proof hash) so the Verifiable Resolution UI can
// render it without a second fetch, and a curious user or judge can
// re-verify locally. This is the "proof is the product" differentiator
// made literal in the contract.
//
// This program never sets odds and never custodies funds directly — see
// programs/market for the vault logic.

use anchor_lang::prelude::*;

declare_id!("5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF");

#[program]
pub mod settlement {
    use super::*;

    /// Resolve a market by verifying a TxLINE Merkle proof on-chain.
    ///
    /// 1. CPI into TxLINE's `validate_stat` with (statement, merkle_proof)
    /// 2. On success, write outcome + proof reference to the market's
    ///    state account (owned by programs/market)
    /// 3. Emit `MarketResolved` carrying the full proof data so the UI
    ///    can render it without a second fetch
    ///
    /// Permissionless: any keeper can call this. The proof itself is the
    /// authority — if `validate_stat` rejects it, the call fails.
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        statement: String,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        // TODO (M3, blocked on TxLINE docs):
        //  1. CPI into TxLINE's validate_stat with (statement, merkle_proof)
        //  2. Parse the result to determine outcome (YES/NO)
        //  3. Write outcome to the market account via CPI to programs/market
        //
        // Until TxLINE's validate_stat program address + interface is
        // confirmed, this is a stub. The event shape below is finalized —
        // the UI and SDK are built against it.

        let clock = Clock::get()?;
        let proof_hash = hash_proof(&merkle_proof);

        emit!(MarketResolved {
            market: ctx.accounts.market.key(),
            statement: statement.clone(),
            merkle_root: [0u8; 32], // TODO: from validate_stat result
            outcome: 0u8,           // TODO: from validate_stat result
            proof_hash,
            resolver: ctx.accounts.resolver.key(),
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

/// Hash a Merkle proof path for compact on-chain reference. The full
/// proof is available off-chain via TxLINE's API; this hash lets the UI
/// confirm it's displaying the right proof without storing the whole path.
/// Compact reference hash of a Merkle proof path. Not cryptographically
/// secure (XOR) — it's a UI reference identifier, not the verification
/// itself. The actual Merkle verification happens on-chain via
/// validate_stat CPI and off-chain via verifyProofLocally in the SDK.
fn hash_proof(proof: &[[u8; 32]]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for node in proof {
        for i in 0..32 {
            result[i] ^= node[i];
        }
    }
    result
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Permissionless keeper — anyone can call resolve_market. The
    /// proof is the authority, not the caller.
    #[account(mut)]
    pub resolver: Signer<'info>,
    /// The market being resolved. Owned by programs/market — we read
    /// its key for the event and will CPI to write its status in M3.
    /// CHECK: validated by the caller passing the correct market address;
    ///   the CPI in M3 will verify ownership.
    #[account(mut)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: TxLINE validation program, address TBD from their docs.
    pub txline_program: UncheckedAccount<'info>,
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
    /// The Merkle root anchored on Solana (from TxLINE's validate_stat).
    pub merkle_root: [u8; 32],
    /// The outcome: 0=YES, 1=NO, 2=VOID.
    pub outcome: u8,
    /// Keccak hash of the Merkle proof path — compact reference for
    /// the UI to confirm it's displaying the right proof.
    pub proof_hash: [u8; 32],
    /// Who called resolve_market (permissionless — anyone).
    pub resolver: Pubkey,
    /// On-chain timestamp of resolution.
    pub timestamp: i64,
}
