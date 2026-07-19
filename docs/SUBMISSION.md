# Submission Notes

## Public Links

- Deployed app: https://stoppage.sportwarren.com
- Public repo: https://github.com/sneldao/stoppage
- Devnet market program: `92TmrM6wKEUWnnH9QAo7VNjzHhTFeAxz8MB7v2wQzjLG`
- Devnet settlement program: `5vCo4bXgUJrDiYLs8Lg4s5CGp1D9CBCBr5WsKCUnkLcF`

## Core Idea

Stoppage is a devnet protocol demo for proof-gated in-play sports
micro-markets. The product is not presented as a production sportsbook.
The important mechanism is deterministic settlement: a market can resolve
only after the settlement program verifies a TxLINE Merkle proof on-chain
via CPI into TxLINE's `validate_stat` instruction. The market program then
consumes the resulting settlement receipt before releasing the peer-funded
vault.

A second proof surface runs alongside settlement: a verifiable quant market-
maker. Matchkeeper prices each open market from a deterministic Monte Carlo
model, anchors the quote inputs in a `PricingReceipt`, and signs the quote
with its Ed25519 key. Anyone can re-run the published model against the
anchored snapshot and confirm the price — the "no black box" loop that
onchain apps can offer and web2 sportsbooks cannot.

## What To Show In The Demo

1. Open the deployed app and show the live match instrument on mobile width.
2. Use the persistent top nav to move from the match desk to the market tape,
   then into a focused market. The route motion is intentionally short and
   state-preserving so it reads as one live instrument, not a multipage
   sportsbook.
3. Connect a devnet wallet and delegate a session key once.
4. Close or avoid the wallet popup path, then place a small devnet position
   with the session key.
5. Open a focused market with a live quote and show the pricing receipt:
   anchored snapshot hash, model version, fair value, bid/ask, and agent
   signature. Click "Verify this price" to re-run the open model in the
   browser and confirm the on-chain quote reproduces.
6. Open a settled market and show the resolution/proof panel.
7. Show the public board. It is derived from on-chain market and position
   accounts, not local browser history.
8. Open Solana Explorer for the settlement transaction and market account.

## TxLINE Endpoints Used

| Endpoint | Used for |
|---|---|
| `GET /fixtures` | Match discovery, home scoreboard, agent fixture polling |
| `GET /fixtures/{id}/score` | Live score, corners, cards for the featured match and for quant snapshots |
| `GET /fixtures/{id}/validation-proof` | Merkle proof fetched by settlement agent, verified on-chain via CPI |
| TxLINE on-chain `validate_stat` CPI | Called by `settlement` program's `resolve_market` instruction to gate fund release |
| SSE event stream | Agent loop (`apps/agent`) for real-time match events → market creation and live re-pricing |

- Fixtures snapshot: powers match discovery and the home scoreboard.
- Scores snapshot: powers fixture-level score, corner, and card state.
- Score validation proof: fetches the Merkle proof used by the settlement
  transaction.
- TxLINE on-chain validation program: verifies the score/stat proof during
  `resolve_market`.

## Verified Devnet Activity

The public board currently has multiple proof-backed demo markets, not just
one smoke test. It is intentionally small because all activity is devnet
demo activity created for judging.

Primary proof-board demo market:

- Market: `ABwKxVtpjUDSchiXQca3dieEurXaXaVN5ZsiiYwDHFLj`
- Settlement tx: `3mgA3vpM5oXZTQb9KDuXkqYujTocx7dpuJg7SgPEcBgVZF7DVqwFcxg8e3FFZ3BoagzDzHT67d3GhhnWzEGzXybD`
- Winner claim tx: `3vwzwCH7XsSRKtKs9P65SpxzD27Ha7ZRPKH696YYu6yoo8DFfGprapYmCDrWd9ndRyncmYc9mUHfsgmLbab4nkYx`

Latest public board verification:

- `playerCount`: 5
- `verifiedMarketCount`: 3
- `totalAttestations`: 3

## Interface Progress

- The app shell now uses a single persistent instrument nav across the match
  desk, market tape, and focused market views.
- The match desk now gives a first-time user one explicit three-step path:
  connect a devnet wallet, approve a bounded Fast Session, then make a first
  read. The mobile dock mirrors the next incomplete step instead of linking
  generically to a bet slip.
- `Matchkeeper` is the visible product name for the constrained autonomous
  agent. Its live status and current activity are shown on the match desk and
  focused market views; an expandable explanation makes clear that it watches
  TxLINE data and submits proof-gated settlement, but cannot choose positions,
  move funds outside program rules, or change a verified outcome.
- The focused market now retains its resolution path in view from TxLINE feed
  through market close, proof validation, and settlement. Its states are
  derived from the on-chain market status rather than simulated progress.
- The market tape supports `All`, `Live`, `Settling`, and `Resolved` filters,
  then groups visible markets by match so the user can read the fixture context
  before opening a focused position.
- `/match` is the operational Match control room: it combines the active
  TxLINE fixture snapshot, a connected wallet's positions in that match,
  fixture-scoped markets, Matchkeeper's derived state sequence, and the
  proof-gated resolution path in one route.
- Market lifecycle is explicit: open windows show a lightweight local
  countdown, closing/validation/settled/void states are visibly distinct, and
  every proof panel links directly to its devnet market account in Explorer.
- Matchkeeper now emits an append-only activity ledger for real TxLINE
  observations, market creation, proof preparation, settlement, voids, and
  failures. `/match` reads the web container's read-only view of that ledger
  and links available market/signature evidence to Explorer.
- Fixture discovery exposes the canonical agent `matchId`, so `/match` joins
  markets to their actual TxLINE fixture rather than using a visually plausible
  fallback. A user's confirmed signed positions persist in their own activity
  history and appear beside Matchkeeper activity without being misrepresented
  as keeper actions.
- Motion is bounded and semantic: the signal grid animates on live score/stat
  changes, odds and selected sides transition in place, and route changes use
  short transform/opacity transitions.
- The UX continues to frame Stoppage as a devnet protocol and verification
  demo. It avoids production sportsbook claims and keeps session state,
  proof status, and TxLINE connectivity visible.
- **Verifiable pricing UI**: focused markets show a live fair-value
  sparkline, bid/ask depth, and a pricing receipt panel. The
  "Verify this price" button re-runs the open-source Monte Carlo model
  against the anchored snapshot and confirms the on-chain fair value
  reproduces. `/calibration` explains the model methodology; `/operators`
  frames the protocol as B2B pricing + settlement infrastructure.

## Scope And Compliance Framing

This project is a hackathon/devnet implementation of a settlement and
verification pattern. It does not claim production gambling compliance,
does not offer mainnet wagering, does not custody a house book, and does
not set odds as an operator. Markets are peer-funded devnet vaults whose
resolution path is constrained by deterministic TxLINE proof verification.

Any real-value launch would require jurisdiction-specific legal review,
consumer protection review, responsible-gaming controls, production
security review, and a decision about whether the market structure is
legally permissible in each target jurisdiction.

## Honest Limitations

- Current board activity is seeded devnet demo activity, not organic user
  traffic.
- Public board indexing uses Shyft when available and public devnet RPC as
  a fallback; production would need a dedicated indexer or paid indexed RPC.
- Launch templates are intentionally narrow: total goals and total corners
  are active because their TxLINE stat-proof mappings are deterministic.
- Session-key delegation is devnet-proven and scoped by caps/expiry, but
  production mobile custody and recovery UX would need additional review.

## TxLINE Feedback

What worked well:

- The free devnet tier was enough to activate credentials, fetch fixtures,
  fetch score snapshots, and retrieve validation proofs.
- The on-chain validation primitive made the settlement story much stronger
  than a normal off-chain oracle callback.

Friction:

- The proof and score APIs require careful alignment of network, JWT,
  activated API token, fixture ID, sequence number, stat key, and program ID.
- Devnet indexed account reads are not available on the Shyft free plan, so
  the public board needs a fallback RPC path for judging.
- Demo setup benefits from known-good fixture/sequence/stat examples because
  live match availability may not line up with judging time.
