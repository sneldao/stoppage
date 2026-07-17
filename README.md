# Stoppage

**Markets that live inside the match, not around it.**

A permissionless, session-key-native settlement protocol for in-play sports
micro-markets, built on Solana and powered by TxLINE's cryptographically
signed match data. Built for the TxODDS World Cup track (Superteam Earn).

> Alt name considered: **Onside Protocol** — swap freely, `stoppage` is used
> as the working name throughout this scaffold.

---

## Why "Stoppage"

Stoppage time is the part of a match where everything that matters happens
in compressed, unpredictable bursts — a corner, a card, a last-minute winner.
That's the exact shape of the product: short-lived, high-frequency,
in-play micro-markets ("next goal in 10 minutes?", "another corner before
half time?") rather than a pre-match odds board.

## What actually differentiates this build

Most World Cup track submissions will wire a frontend to the TxLINE SSE
stream and call it done. The bets we're making on differentiation:

1. **Session-key delegated betting (the core bet).**
   A wallet approves a session key *once*. Every micro-market entry after
   that is a signed instruction from the session key — no wallet popup per
   bet. This is the difference between "an app that shows odds" and "an app
   you can actually use during a live match." This is also the piece most
   likely to be half-built and decorative if rushed — it is the first thing
   to get end-to-end, not the last.

2. **Protocol, not sportsbook.**
   Stoppage never custodies a house position and never sets odds. Markets
   are peer-funded vaults (PDA escrows); Stoppage's code only (a) verifies a
   TxLINE Merkle proof via on-chain CPI into `validate_stat`, and (b) releases
   funds per pre-declared, deterministic rules. There's no operator taking
   the other side of a bet — the protocol is closer to an escrow + oracle-CPI
   settlement layer than a bookmaker. The on-chain CPI is verified on devnet:
   the settlement program's `resolve_market` instruction calls TxLINE's
   `validate_stat`, reads the boolean return, and emits a proof-carrying
   `MarketResolved` event. This is a real architectural choice, not just a
   compliance fig leaf: it's also what the bounty's "permissionless results
   validation" track explicitly rewards. It does **not** by itself make this
   compliant with UK gambling law — that determination needs actual legal
   advice before any real-money/mainnet launch — but it is the correct shape
   to build toward either way.

3. **Verifiable Resolution UI — the proof is the product.**
   Every settled market surfaces the raw TxLINE Merkle proof/receipt used
   to release funds. Users can independently verify the outcome without
   trusting Stoppage, TxODDS, or each other. This is explicitly called out
   as a rewarded idea in the bounty brief, and it's a natural fit for the
   "transparency" pitch in the demo video.

4. **Composable market templates, not a fixed odds book.**
   Markets are defined by small predicate templates (`next_goal_within(t)`,
   `corners(team) > n`, `card_shown(team, player_role)`) evaluated against
   the normalized TxLINE schema, rather than one bespoke contract per bet
   type. New market types are template instances, not new programs.

5. **Blinks-native bet slips.**
   Every market and every open position is a shareable Solana Action —
   "back this" or "here's my slip" posts natively to X with a one-tap
   join/view flow. This is the single most demo-able, judge-visible hook
   for a World Cup audience.

6. **Settlement history as a public leaderboard.**
   Reusing the replay/leaderboard primitives: settled markets and resolved
   proofs feed a public, verifiable accuracy leaderboard — social proof and
   a second use for the same data model, at near-zero extra cost.

## Quickstart

```bash
npm install
cp apps/web/.env.local.example apps/web/.env.local   # add Helius API key
npm run dev                                          # web app on :3000
npm run anchor:build                                 # build both programs
```

Full toolchain notes (rustup vs Homebrew cargo, lockfile pins, deploy
pipeline): [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Repo layout

```
stoppage/
├── CLAUDE.md                    Working rules — read before changing anything
├── apps/
│   ├── agent/                   Autonomous agent: TxLINE SSE → market create/settle
│   │   └── src/
│   │       ├── index.ts         Entry point (live / replay modes, --live-tx flag)
│   │       ├── source.ts        TxLINE event source (live SSE + historical replay)
│   │       ├── loop.ts          Agent loop: create/settle/void + proof attestation
│   │       └── strategy.ts      Predicate evaluator + settlement logic
│   └── web/                     Next.js app (UI + Actions/Blinks routes)
│       ├── app/
│       │   ├── api/actions/[market]/   Solana Actions (Blinks) endpoint
│       │   └── api/fixtures/           TxLINE fixtures proxy (server-side)
│       ├── components/                 WalletProvider, ShareBar, StatsPanel,
│       │                               PositionHistory, MatchCalendar, ReferralInit
│       ├── lib/
│       │   ├── wallet/                 Wallet adapters (web + Solana Mobile)
│       │   ├── session-key/            useSessionKey hook (local keypair lifecycle)
│       │   ├── helius/                 HeliusMonitor (live settlement/odds ticks)
│       │   ├── markets/                useMarkets, useMarketActions, useMyPositions
│       │   ├── share/                  Tweet generation (buildMarketTweet, buildTweetIntent)
│       │   ├── actions/                Blinks CORS helpers
│       │   └── format.ts               Shared formatters (formatSol, LAMPORTS_PER_SOL)
│       └── store/                      Zustand slices (markets, positions, referral, history)
├── programs/
│   ├── market/                  Anchor program: market vaults, join/claim
│   └── settlement/              Anchor program: on-chain CPI into TxLINE
│                                 validate_stat + proof-carrying MarketResolved
├── packages/
│   ├── sdk/                     TS that touches the chain: types, escrow, proofs,
│   │                            session-key signing, program IDs, IDLs, PREDICATE_LABEL
│   └── txline/                  TxLINE API client: auth, SSE, fixtures, scores,
│                                validation proofs, normalizer, credential loading
├── keys/                        Program keypairs — single source of truth
│                                for program IDs (devnet only; see keys/README)
├── scripts/                     check-ids / sync-ids / deploy.sh / subscribe-txline.ts
└── docs/
    ├── ARCHITECTURE.md          Design: core flow, session-key delegation
    ├── DEVELOPMENT.md           Toolchain, commands, ID discipline
    └── ROADMAP.md               Milestones, status ledger, icebox, risks
```

## Status

Lives in [docs/ROADMAP.md](./docs/ROADMAP.md) — the single status ledger —
and nowhere else, so it can't rot here. (The predecessor repo's README
claimed a program was "LIVE" at an address two deployments stale.)

## Compliance note (read before writing settlement code)

This project involves escrow and payout logic tied to real-world event
outcomes. If you take this past devnet/hackathon scope with real value,
UK gambling regulation (Gambling Act 2005, UKGC) and related consumer/
financial rules may apply depending on exactly how markets are structured
and marketed. Nothing in this repo is legal advice; get a real opinion
before any mainnet or real-currency deployment.
