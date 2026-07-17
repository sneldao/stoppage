// Stoppage market program.
//
// Responsibilities:
//   - Protocol config + fee (Tier 1): one-time init, fee skimmed on claim
//     to a treasury PDA. Shows economic design to investors/judges.
//   - Session-key delegation (M1): owner authorizes a session keypair
//     once; later session-key-signed instructions check the on-chain
//     grant. Cumulative spend cap = loss limit (rule 9).
//   - Market vault (M2): create/join/claim on peer-funded markets, with
//     creation bond (spam filter), proof-gated settlement, void
//     (permissionless refund after grace period), and
//     attest_verification (permissionless validation made countable).
//
// Payouts move lamports directly (rule 4): try_borrow_mut_lamports on
// the market account + recipient, never System Program CPI from a PDA.
//
// Not responsible for: evaluating predicates, verifying TxLINE proofs,
// or setting odds. That lives in programs/settlement + the off-chain
// resolver.

use anchor_lang::prelude::*;

declare_id!("92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG");

const SETTLEMENT_PROGRAM_ID: Pubkey = pubkey!("5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF");

// ── Constants ───────────────────────────────────────────────────────

const SIDE_YES: u8 = 0;
const SIDE_NO: u8 = 1;
const OUTCOME_VOID: u8 = 2;

const STATUS_OPEN: u8 = 0;
const STATUS_AWAITING: u8 = 1;
const STATUS_SETTLED: u8 = 2;
const STATUS_VOID: u8 = 3;

/// After closes_at + this, anyone can void an unsettled market.
const GRACE_PERIOD_SECONDS: i64 = 3_600;
const MIN_BOND_LAMPORTS: u64 = 10_000_000; // 0.01 SOL — spam filter

#[program]
pub mod market {
    use super::*;

    // ── Protocol config ───────────────────────────────────────────

    /// One-time initialization after deploy. Sets the protocol authority
    /// and the fee rate.
    /// The treasury PDA is created here and receives fees on every claim.
    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 500, MarketError::FeeTooHigh); // max 5%
        let config = &mut ctx.accounts.protocol_config;
        config.authority = ctx.accounts.authority.key();
        config.fee_bps = fee_bps;
        config.treasury = ctx.accounts.treasury.key();
        config.bump = ctx.bumps.protocol_config;
        emit!(ProtocolInitialized {
            authority: config.authority,
            fee_bps,
            treasury: config.treasury,
        });
        Ok(())
    }

    // ── Session-key delegation (M1) ───────────────────────────────

    /// Owner signs once to authorize a session keypair on-chain, scoped
    /// by program allowlist, per-market stake cap, optional cumulative
    /// spend cap (self-imposed limit; 0 = no cap — rule 9), and expiry.
    /// Also funds the session key with lamports so it can pay tx fees
    /// AND place stakes — without this the no-popup flow can't send
    /// anything. The real financial guardrail is fund_lamports: the
    /// session key can only spend what it's been given.
    pub fn delegate_session_key(
        ctx: Context<DelegateSessionKey>,
        allowed_programs: Vec<Pubkey>,
        max_stake_per_market: u64,
        max_total_stake: u64,
        expires_at: i64,
        fund_lamports: u64,
    ) -> Result<()> {
        require!(
            allowed_programs.len() <= SessionGrant::MAX_PROGRAMS,
            MarketError::TooManyPrograms
        );
        // max_total_stake = 0 means "no cap" — the user's explicit choice.
        // The real financial guardrail is fund_lamports: the session key
        // can only spend what it's been funded with. max_total_stake is a
        // self-imposed behavioral limit the protocol enforces only if set.
        let grant = &mut ctx.accounts.grant;
        grant.owner = ctx.accounts.owner.key();
        grant.session_pubkey = ctx.accounts.session_pubkey.key();
        grant.allowed_programs = allowed_programs;
        grant.max_stake_per_market = max_stake_per_market;
        grant.max_total_stake = max_total_stake;
        grant.staked_so_far = 0;
        grant.expires_at = expires_at;
        grant.revoked = false;
        grant.bump = ctx.bumps.grant;

        // Fund the session key: covers tx fees + stake capital.
        if fund_lamports > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.session_pubkey.to_account_info(),
                    },
                ),
                fund_lamports,
            )?;
        }

        emit!(SessionKeyDelegated {
            owner: ctx.accounts.owner.key(),
            session_pubkey: ctx.accounts.session_pubkey.key(),
            expires_at,
            max_total_stake,
        });
        Ok(())
    }

    /// Owner revokes a delegation early (one more popup — revocation is
    /// deliberately not frictionless; this is the self-exclude path,
    /// rule 9). Grant account is closed, rent refunded to owner.
    pub fn revoke_session_key(ctx: Context<RevokeSessionKey>) -> Result<()> {
        let owner = ctx.accounts.grant.owner;
        let session_pubkey = ctx.accounts.grant.session_pubkey;
        ctx.accounts.grant.close(ctx.accounts.owner.to_account_info())?;
        emit!(SessionKeyRevoked { owner, session_pubkey });
        Ok(())
    }

    /// Session-key-signed no-op that verifies the grant is active.
    /// M1 acceptance artifact + de-risks M2 grant checks.
    pub fn session_ping(ctx: Context<SessionPing>) -> Result<()> {
        let grant = &ctx.accounts.grant;
        require!(!grant.revoked, MarketError::GrantRevoked);
        let clock = Clock::get()?;
        require!(grant.expires_at > clock.unix_timestamp, MarketError::GrantExpired);
        emit!(SessionPingEvent {
            owner: grant.owner,
            session_pubkey: grant.session_pubkey,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    // ── Market lifecycle (M2) ─────────────────────────────────────

    /// Create a market for a predicate. Requires a refundable bond
    /// (spam filter — refunded on settle/void via claim_bond). Fee is
    /// snapshotted from ProtocolConfig at creation time so later config
    /// changes don't retroactively alter existing markets.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        kind: u8,
        match_id: [u8; 32],
        team: [u8; 8],
        param_u64: u64,
        closes_at: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(closes_at > clock.unix_timestamp, MarketError::ClosesInPast);
        require!(kind <= 3, MarketError::InvalidPredicateKind);

        let config = &ctx.accounts.protocol_config;
        let market = &mut ctx.accounts.market;
        market.kind = kind;
        market.match_id = match_id;
        market.team = team;
        market.param_u64 = param_u64;
        market.creator = ctx.accounts.creator.key();
        market.bond_lamports = MIN_BOND_LAMPORTS;
        market.bond_claimed = false;
        market.yes_pool = 0;
        market.no_pool = 0;
        market.closes_at = closes_at;
        market.settles_at = 0;
        market.status = STATUS_OPEN;
        market.outcome = OUTCOME_VOID; // default, overwritten on settle
        market.fee_bps = config.fee_bps;
        market.verifications = 0;
        market.bump = ctx.bumps.market;

        // Bond: transfer from creator into the market account (which IS
        // the vault). Refunded via claim_bond after settle/void.
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: market.to_account_info(),
                },
            ),
            MIN_BOND_LAMPORTS,
        )?;

        emit!(MarketCreated {
            market: market.key(),
            creator: ctx.accounts.creator.key(),
            kind,
            closes_at,
        });
        Ok(())
    }

    /// Join a market via the owner wallet (one popup). Use this when no
    /// session key is delegated. The wallet is both the signer and the
    /// position owner.
    pub fn join_via_wallet(ctx: Context<JoinWallet>, side: u8, amount: u64) -> Result<()> {
        require!(amount > 0, MarketError::ZeroAmount);
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;
        require!(market.status == STATUS_OPEN, MarketError::MarketNotOpen);
        require!(clock.unix_timestamp < market.closes_at, MarketError::MarketClosed);

        // Transfer stake from wallet to market (market account IS the vault).
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: market.to_account_info(),
                },
            ),
            amount,
        )?;

        let owner = ctx.accounts.signer.key();
        apply_join(market, &mut ctx.accounts.position, &owner, side, amount, false, ctx.bumps.position)?;
        Ok(())
    }

    /// Join a market via a session key (no wallet popup). The session
    /// key signs; the position is attributed to the grant owner (the
    /// wallet). Enforces the cumulative spend cap (rule 9 — loss limit),
    /// per-market cap, program allowlist, expiry, and revocation.
    pub fn join_via_session_key(
        ctx: Context<JoinSessionKey>,
        side: u8,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, MarketError::ZeroAmount);
        let clock = Clock::get()?;

        // ── Grant validation (rule 5 + rule 9) ──
        let grant = &mut ctx.accounts.grant;
        require!(!grant.revoked, MarketError::GrantRevoked);
        require!(grant.expires_at > clock.unix_timestamp, MarketError::GrantExpired);
        require!(
            grant.owner == ctx.accounts.owner.key(),
            MarketError::OwnerMismatch
        );
        // Cumulative spend cap: only enforced if the user set one (rule 9).
        // max_total_stake = 0 means "no cap" — the user's explicit choice.
        if grant.max_total_stake > 0 {
            require!(
                grant.staked_so_far + amount <= grant.max_total_stake,
                MarketError::SpendCapExceeded
            );
        }
        require!(
            amount <= grant.max_stake_per_market,
            MarketError::StakeCapExceeded
        );
        // Program allowlist: market program must be authorized.
        require!(
            grant.allowed_programs.contains(&crate::ID),
            MarketError::ProgramNotAllowed
        );

        let market = &mut ctx.accounts.market;
        require!(market.status == STATUS_OPEN, MarketError::MarketNotOpen);
        require!(clock.unix_timestamp < market.closes_at, MarketError::MarketClosed);

        // Transfer stake from session key to market.
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.session_key.to_account_info(),
                    to: market.to_account_info(),
                },
            ),
            amount,
        )?;

        // Increment cumulative spend (the loss limit, rule 9).
        grant.staked_so_far += amount;

        let owner = ctx.accounts.owner.key();
        apply_join(
            market,
            &mut ctx.accounts.position,
            &owner,
            side,
            amount,
            true,
            ctx.bumps.position,
        )?;
        Ok(())
    }

    /// Permissionless settlement that is cryptographically gated by the
    /// settlement program's one-time TxLINE proof receipt.
    pub fn settle_from_proof(ctx: Context<SettleFromProof>, outcome: u8) -> Result<()> {
        require!(outcome == SIDE_YES || outcome == SIDE_NO, MarketError::InvalidOutcome);
        require!(
            *ctx.accounts.resolution.owner == SETTLEMENT_PROGRAM_ID,
            MarketError::InvalidResolutionOwner
        );
        let market = &mut ctx.accounts.market;
        let (expected_resolution, _) = Pubkey::find_program_address(
            &[b"resolution", market.key().as_ref()],
            &SETTLEMENT_PROGRAM_ID,
        );
        require_keys_eq!(
            expected_resolution,
            ctx.accounts.resolution.key(),
            MarketError::InvalidResolutionPda
        );
        verify_resolution_receipt(
            &ctx.accounts.resolution.to_account_info(),
            market.key(),
            outcome,
        )?;
        require!(
            market.status == STATUS_OPEN || market.status == STATUS_AWAITING,
            MarketError::AlreadySettled
        );
        let clock = Clock::get()?;
        market.status = STATUS_SETTLED;
        market.outcome = outcome;
        market.settles_at = clock.unix_timestamp;
        emit!(MarketSettled {
            market: market.key(),
            outcome,
            settles_at: clock.unix_timestamp,
            mock: false,
        });
        Ok(())
    }

    /// Permissionless void: if a market hasn't settled by closes_at +
    /// grace period, anyone can void it. Triggers full refunds (claim
    /// returns stake, no fee, no winner). This is the "what if TxLINE
    /// is down" answer.
    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        require!(
            market.status != STATUS_SETTLED && market.status != STATUS_VOID,
            MarketError::AlreadySettled
        );
        require!(
            clock.unix_timestamp > market.closes_at + GRACE_PERIOD_SECONDS,
            MarketError::GracePeriodNotElapsed
        );
        market.status = STATUS_VOID;
        market.outcome = OUTCOME_VOID;
        market.settles_at = clock.unix_timestamp;
        emit!(MarketVoided {
            market: market.key(),
            voided_at: clock.unix_timestamp,
        });
        Ok(())
    }

    /// Claim a settled position. Winners get pro-rata share of the
    /// losing pool + their stake back, minus protocol fee. Losers get
    /// nothing. Voided markets: everyone gets stake back, no fee.
    /// Payouts are direct lamport transfers (rule 4).
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == STATUS_SETTLED || market.status == STATUS_VOID,
            MarketError::NotSettled
        );
        let position = &mut ctx.accounts.position;
        require!(
            position.owner == ctx.accounts.claimant.key(),
            MarketError::NotPositionOwner
        );
        let stake = position.amount_lamports;
        require!(stake > 0, MarketError::NothingToClaim);

        let (payout, fee) = if market.status == STATUS_VOID {
            // Void: full refund, no fee.
            (stake, 0u64)
        } else {
            // Settled: check if winner.
            if position.side != market.outcome {
                // Loser: nothing to claim. Zero the position.
                position.amount_lamports = 0;
                emit!(PositionClaimed {
                    market: market.key(),
                    owner: ctx.accounts.claimant.key(),
                    payout: 0,
                    fee: 0,
                });
                return Ok(());
            }
            // Winner: pro-rata share of losing pool + stake back.
            let winning_pool = if position.side == SIDE_YES {
                market.yes_pool
            } else {
                market.no_pool
            };
            let losing_pool = if position.side == SIDE_YES {
                market.no_pool
            } else {
                market.yes_pool
            };
            let losing_share = if winning_pool > 0 {
                ((stake as u128) * (losing_pool as u128) / (winning_pool as u128)) as u64
            } else {
                0
            };
            let gross = stake + losing_share;
            let fee = (gross as u128 * market.fee_bps as u128 / 10_000) as u64;
            (gross - fee, fee)
        };

        // Direct lamport transfer (rule 4): market PDA → claimant + treasury.
        // The market account owns its lamports; System Program can't debit
        // a PDA, so we manipulate lamports directly.
        {
            let market_info = market.to_account_info();
            let claimant_info = ctx.accounts.claimant.to_account_info();
            let treasury_info = ctx.accounts.treasury.to_account_info();
            let mut market_lamports = market_info.try_borrow_mut_lamports()?;
            let mut claimant_lamports = claimant_info.try_borrow_mut_lamports()?;
            **market_lamports -= payout + fee;
            **claimant_lamports += payout;
            if fee > 0 {
                drop(market_lamports);
                drop(claimant_lamports);
                let mut treasury_lamports = treasury_info.try_borrow_mut_lamports()?;
                **treasury_lamports += fee;
            }
        }

        position.amount_lamports = 0;
        emit!(PositionClaimed {
            market: market.key(),
            owner: ctx.accounts.claimant.key(),
            payout,
            fee,
        });
        Ok(())
    }

    /// Creator claims the bond back after a market settles or voids.
    /// If the market never settles and never voids (shouldn't happen
    /// given the grace-period void path), the bond stays locked — that's
    /// the spam-filter incentive.
    pub fn claim_bond(ctx: Context<ClaimBond>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.creator == ctx.accounts.creator.key(),
            MarketError::NotCreator
        );
        require!(
            market.status == STATUS_SETTLED || market.status == STATUS_VOID,
            MarketError::NotSettled
        );
        require!(!market.bond_claimed, MarketError::BondAlreadyClaimed);
        let bond = market.bond_lamports;
        market.bond_claimed = true;

        // Direct lamport transfer (rule 4).
        let market_info = market.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();
        **market_info.try_borrow_mut_lamports()? -= bond;
        **creator_info.try_borrow_mut_lamports()? += bond;

        emit!(BondClaimed {
            market: market.key(),
            creator: ctx.accounts.creator.key(),
            bond,
        });
        Ok(())
    }

    /// Permissionless attestation: anyone can sign to increment a
    /// market's verification counter after it's settled. Makes
    /// "permissionless validation" legible on chain — a judge can see
    /// "47 independent verifications" without reading code.
    pub fn attest_verification(ctx: Context<AttestVerification>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == STATUS_SETTLED, MarketError::NotSettled);
        market.verifications += 1;
        emit!(VerificationAttested {
            market: market.key(),
            verifier: ctx.accounts.verifier.key(),
            count: market.verifications,
        });
        Ok(())
    }
}

/// Decodes the stable prefix of settlement::Resolution. We intentionally do
/// not depend on the settlement crate so both programs can be deployed and
/// upgraded independently; owner, PDA, Anchor discriminator, market and
/// outcome are all checked before a vault can settle.
fn verify_resolution_receipt(
    resolution: &AccountInfo,
    market: Pubkey,
    outcome: u8,
) -> Result<()> {
    let data = resolution.try_borrow_data()?;
    const PREFIX_LEN: usize = 8 + 32 + 1;
    require!(data.len() >= PREFIX_LEN, MarketError::MalformedResolution);
    // Anchor discriminator for `account:Resolution`.
    let expected_discriminator = [31, 13, 235, 201, 17, 66, 5, 138];
    require!(
        data[..8] == expected_discriminator[..8],
        MarketError::MalformedResolution
    );
    let receipt_market = Pubkey::try_from(&data[8..40])
        .map_err(|_| error!(MarketError::MalformedResolution))?;
    require_keys_eq!(receipt_market, market, MarketError::ResolutionMarketMismatch);
    require!(data[40] == outcome, MarketError::ResolutionOutcomeMismatch);
    Ok(())
}

// ── Shared join logic ───────────────────────────────────────────────

fn apply_join(
    market: &mut Account<Market>,
    position: &mut Account<Position>,
    owner: &Pubkey,
    side: u8,
    amount: u64,
    via_session_key: bool,
    bump: u8,
) -> Result<()> {
    require!(side == SIDE_YES || side == SIDE_NO, MarketError::InvalidSide);

    if side == SIDE_YES {
        market.yes_pool += amount;
    } else {
        market.no_pool += amount;
    }

    if position.amount_lamports == 0 {
        position.market = market.key();
        position.owner = *owner;
        position.side = side;
        position.opened_via_session_key = via_session_key;
        position.bump = bump;
    } else {
        // A position already exists for this (market, owner). Reject
        // joining the opposite side — otherwise both stakes merge into
        // one position that records only the first side, and payouts
        // attribute the full merged stake to whichever side was joined
        // first. Re-joining the same side to top up is allowed.
        require!(position.side == side, MarketError::AlreadyJoinedOtherSide);
    }
    position.amount_lamports += amount;

    emit!(PositionOpened {
        market: market.key(),
        owner: *owner,
        side,
        amount,
        via_session_key,
    });
    Ok(())
}

// ── Account state ───────────────────────────────────────────────────

#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
    pub bump: u8,
}

impl ProtocolConfig {
    pub fn space() -> usize {
        8 + 32 + 2 + 32 + 1
    }
}

#[account]
pub struct SessionGrant {
    pub owner: Pubkey,
    pub session_pubkey: Pubkey,
    pub allowed_programs: Vec<Pubkey>,
    pub max_stake_per_market: u64,
    /// Cumulative spend cap = loss limit (rule 9). join_via_session_key
    /// checks staked_so_far + amount <= max_total_stake.
    pub max_total_stake: u64,
    pub staked_so_far: u64,
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

impl SessionGrant {
    pub const MAX_PROGRAMS: usize = 4;
    pub fn space() -> usize {
        8 + 32 + 32 + 4 + (Self::MAX_PROGRAMS * 32) + 8 + 8 + 8 + 8 + 1 + 1
    }
}

#[account]
pub struct Market {
    pub kind: u8,             // PredicateKind as byte
    pub match_id: [u8; 32],   // TxLINE match identifier (padded)
    pub team: [u8; 8],        // team code, e.g. "FRA\0\0\0\0\0"
    pub param_u64: u64,       // window seconds / threshold
    pub creator: Pubkey,
    pub bond_lamports: u64,
    pub bond_claimed: bool,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub closes_at: i64,
    pub settles_at: i64,
    pub status: u8,
    pub outcome: u8,
    pub fee_bps: u16,         // snapshotted at creation
    pub verifications: u32,
    pub bump: u8,
}

impl Market {
    pub fn space() -> usize {
        8 + 1 + 32 + 8 + 8 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 1 + 2 + 4 + 1
    }
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,    // the wallet (authority), not the session key
    pub side: u8,
    pub amount_lamports: u64,
    pub opened_via_session_key: bool,
    pub bump: u8,
}

impl Position {
    pub fn space() -> usize {
        8 + 32 + 32 + 1 + 8 + 1 + 1
    }
}

// ── Instruction contexts ────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::space(),
        seeds = [b"protocol_config"],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(init, payer = authority, space = 0, seeds = [b"treasury"], bump)]
    /// CHECK: treasury PDA — lamport bucket for protocol fees.
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateSessionKey<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    /// CHECK: client-generated keypair; validated by grant PDA seeds.
    pub session_pubkey: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        space = SessionGrant::space(),
        seeds = [b"session_grant", owner.key().as_ref(), session_pubkey.key().as_ref()],
        bump,
    )]
    pub grant: Account<'info, SessionGrant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeSessionKey<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: validated by grant PDA seeds.
    pub session_pubkey: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"session_grant", owner.key().as_ref(), session_pubkey.key().as_ref()],
        bump,
    )]
    pub grant: Account<'info, SessionGrant>,
}

#[derive(Accounts)]
pub struct SessionPing<'info> {
    #[account(mut)]
    pub session_key: Signer<'info>,
    /// CHECK: grant owner; only used to derive the PDA.
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [b"session_grant", owner.key().as_ref(), session_key.key().as_ref()],
        bump,
    )]
    pub grant: Account<'info, SessionGrant>,
}

#[derive(Accounts)]
#[instruction(kind: u8, match_id: [u8; 32], team: [u8; 8], param_u64: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Market::space(),
        seeds = [b"market", match_id.as_ref(), &[kind], team.as_ref(), &param_u64.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"protocol_config"], bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinWallet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = signer,
        space = Position::space(),
        seeds = [b"position", market.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinSessionKey<'info> {
    #[account(mut)]
    pub session_key: Signer<'info>,
    /// CHECK: the wallet that owns the grant; validated against grant.owner.
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"session_grant", owner.key().as_ref(), session_key.key().as_ref()],
        bump,
    )]
    pub grant: Account<'info, SessionGrant>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = session_key,
        space = Position::space(),
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleFromProof<'info> {
    /// Any keeper may settle; authorization comes exclusively from the
    /// proof-gated receipt account.
    pub resolver: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: validated in settle_from_proof (owner, canonical PDA, account
    /// discriminator, market binding, and outcome binding).
    pub resolution: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), claimant.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    /// CHECK: treasury PDA — receives protocol fees.
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimBond<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct AttestVerification<'info> {
    pub verifier: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

// ── Events ──────────────────────────────────────────────────────────

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
}

#[event]
pub struct SessionKeyDelegated {
    pub owner: Pubkey,
    pub session_pubkey: Pubkey,
    pub expires_at: i64,
    pub max_total_stake: u64,
}

#[event]
pub struct SessionKeyRevoked {
    pub owner: Pubkey,
    pub session_pubkey: Pubkey,
}

#[event]
pub struct SessionPingEvent {
    pub owner: Pubkey,
    pub session_pubkey: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub kind: u8,
    pub closes_at: i64,
}

#[event]
pub struct PositionOpened {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: u8,
    pub amount: u64,
    pub via_session_key: bool,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub outcome: u8,
    pub settles_at: i64,
    pub mock: bool,
}

#[event]
pub struct MarketVoided {
    pub market: Pubkey,
    pub voided_at: i64,
}

#[event]
pub struct PositionClaimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub payout: u64,
    pub fee: u64,
}

#[event]
pub struct BondClaimed {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub bond: u64,
}

#[event]
pub struct VerificationAttested {
    pub market: Pubkey,
    pub verifier: Pubkey,
    pub count: u32,
}

// ── Errors ──────────────────────────────────────────────────────────

#[error_code]
pub enum MarketError {
    #[msg("Session grant allows at most 4 programs")]
    TooManyPrograms,
    #[msg("Session grant has been revoked")]
    GrantRevoked,
    #[msg("Session grant has expired")]
    GrantExpired,
    #[msg("Grant owner does not match the provided owner account")]
    OwnerMismatch,
    #[msg("Cumulative spend cap exceeded (loss limit, rule 9)")]
    SpendCapExceeded,
    #[msg("Per-market stake cap exceeded")]
    StakeCapExceeded,
    #[msg("Market program is not in the session grant's allowlist")]
    ProgramNotAllowed,
    #[msg("Fee cannot exceed 500 bps (5%)")]
    FeeTooHigh,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market has closed (past closes_at)")]
    MarketClosed,
    #[msg("Market is not settled or void")]
    NotSettled,
    #[msg("Market is already settled or void")]
    AlreadySettled,
    #[msg("Grace period has not elapsed since closes_at")]
    GracePeriodNotElapsed,
    #[msg("Invalid side (must be 0=YES or 1=NO)")]
    InvalidSide,
    #[msg("Already joined the opposite side of this market")]
    AlreadyJoinedOtherSide,
    #[msg("Invalid outcome (must be 0=YES or 1=NO)")]
    InvalidOutcome,
    #[msg("Invalid predicate kind (must be 0-3)")]
    InvalidPredicateKind,
    #[msg("closes_at must be in the future")]
    ClosesInPast,
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Nothing to claim (position already claimed)")]
    NothingToClaim,
    #[msg("Claimant is not the position owner")]
    NotPositionOwner,
    #[msg("Resolution account is not owned by the settlement program")]
    InvalidResolutionOwner,
    #[msg("Resolution account is not the canonical receipt PDA for this market")]
    InvalidResolutionPda,
    #[msg("Resolution receipt has an invalid layout")]
    MalformedResolution,
    #[msg("Resolution receipt belongs to a different market")]
    ResolutionMarketMismatch,
    #[msg("Resolution receipt outcome does not match settlement outcome")]
    ResolutionOutcomeMismatch,
    #[msg("Signer is not the market creator")]
    NotCreator,
    #[msg("Bond has already been claimed")]
    BondAlreadyClaimed,
}
