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

## What To Show In The Demo

1. Open the deployed app and show the live match instrument on mobile width.
2. Use the persistent top nav to move from the match desk to the market tape,
   then into a focused market. The route motion is intentionally short and
   state-preserving so it reads as one live instrument, not a multipage
   sportsbook.
3. Connect a devnet wallet and delegate a session key once.
4. Close or avoid the wallet popup path, then place a small devnet position
   with the session key.
5. Open a settled market and show the resolution/proof panel.
6. Show the public board. It is derived from on-chain market and position
   accounts, not local browser history.
7. Open Solana Explorer for the settlement transaction and market account.

## TxLINE Usage

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
- Motion is bounded and semantic: the signal grid animates on live score/stat
  changes, odds and selected sides transition in place, and route changes use
  short transform/opacity transitions.
- The UX continues to frame Stoppage as a devnet protocol and verification
  demo. It avoids production sportsbook claims and keeps session state,
  proof status, and TxLINE connectivity visible.

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
