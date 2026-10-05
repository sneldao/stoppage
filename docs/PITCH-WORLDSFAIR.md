# Colosseum World's Fair — pitch skeleton (working doc)

Submissions due **Oct 12, 2026**. Judged by Colosseum's fund: insight,
product + execution, market size, founder communication, viability,
traction. Work judged only Sep 14 – Oct 12; all prior dev must be
disclosed (TxODDS Jul, KeeperHub Aug, AnsemHack Sept). Fit table and
window rules: docs/hackathons.md §4.

## The one line

> Fund release gated on a proof the settlement contract verified —
> not on a key, a committee, or a dispute window.

If the pitch does nothing else, it lands this sentence and then *shows*
it in an Explorer transaction.

## 2:30 pitch-video act structure

| Time | Beat | Visual |
|---|---|---|
| 0:00–0:20 | **Problem.** Every on-chain prediction market settles on trust: an admin key, a multisig, a token-vote committee. The bettor can't verify the resolution — they take someone's word. Name a concrete failure (a UMA dispute, an admin-key settle) — pick one real example and say its name. | receipts board scroll → freeze on one receipt |
| 0:20–0:50 | **The primitive.** `resolve_market` CPIs into the market's bound validator; the program reads one byte back. `[1]` → receipt + vault release. Anything else → the whole transaction reverts. No admin-settle path exists in the code. | Explorer on an atomic resolve+settle+release tx; the two programs highlighted |
| 0:50–1:20 | **Oracle-agnostic, demonstrated not claimed.** Three structurally different oracles through the identical receipt path: TxLINE Merkle proofs, ed25519 attestation (multi-tenant), Pyth guardian-signed (deployed; devnet feed paused — say it). | ValidatorRail / receipts filtering by oracle |
| 1:20–1:50 | **Self-serve, proven.** A key we have never seen ran the whole loop: generate → own config PDA → create → sign observation → atomic settle → bond back. Show the fresh-desk run (`.runtime/freshdesk/TRANSCRIPT.txt`, tx sigs on Explorer). The SDK alone is sufficient — that IS the product claim. | terminal replay of the desk.ts run |
| 1:50–2:15 | **Second proof surface.** Matchkeeper anchors quote inputs on-chain; "Verify this price" re-runs the open model in-browser against the exact snapshot. The black-box sportsbook can't do this. | VerifyLatestQuote reproducing |
| 2:15–2:30 | **Vision + ask.** The resolution layer for anything that needs a verified bool to move money — prediction markets, futarchy, data vendors. 25 bps protocol fee on settled volume. Devnet today; mainnet after legal review. | /operators page |

## GTM write-up (submission section)

- **Wedge:** operators whose settlement is today a multisig or admin
  key — prediction-market protocols, futarchy/governance platforms,
  data vendors, on-chain games. They already feel the trust cost;
  we remove it, we don't sell them on the problem.
- **Motion:** self-serve SDK — `operator-quickstart.ts` (one script,
  whole loop) → `examples/prop-desk` (a complete operator in one
  file) → `/operators` (the runnable landing page). Direct outreach
  to operator teams; house desks are *reference implementations*,
  not traction claims.
- **The metric:** one real operator settling one real market. That
  is the whole traction section. Self-staged volume is explicitly
  not claimed.
- **Fallback evidence:** recorded operator conversations / LOIs if
  no external settle lands by Oct 12.

## Honest asterisks (put them in before judges find them)

- All desks on the shared validator so far are house-run. Multi-tenant
  is proven by construction (per-authority config PDA) and by the
  quickstart's non-house key — not yet by a third party in the wild.
- Devnet only. Escrow tied to real-world outcomes is a legal question;
  the infra path doesn't need it answered to be real, but say it.
- Pyth validator deployed and unchanged; its devnet feed is paused.
  Price markets settle attested (Coinbase candles) in the meantime.
- `$STOPPAGE` is a ClawPump entry-ticket token with no utility, no
  promises, no in-protocol role. One disclosure line — not in the
  pitch body. Decide before recording whether it appears at all.
- Team section: solo vs team and backgrounds must be written, not
  implied (founder–market fit is scored). Still unwritten.

## Outreach copy (drafts — you post, not me)

**X post** (pair with the terminal replay):

> Your market, your key, our vault. A fresh keypair just ran the whole
> loop on Solana devnet: pinned its own attestor, created a market,
> signed the observation, and the funds released only after the
> settlement program CPI-verified the proof — one atomic tx, no admin
> path. One file, SDK only:
> github.com/sneldao/stoppage/tree/main/examples/prop-desk

**Operator DM / forum post** (Colosseum arena, Superteam, dev discords):

> Hey — we built the settlement layer where fund release is gated on an
> on-chain proof verification, not an admin key. It's self-serve now:
> `npx tsx scripts/operator-quickstart.ts` runs the whole loop with a
> keypair we never touch (fresh key → own config → market → signed
> observation → atomic settle → bond back). If your markets currently
> settle on a multisig or an admin signature, I'd like to pin your
> attestor and watch you settle one live — 10 minutes, devnet. Happy
> to do it on a call.

**What "yes" looks like:** they run the quickstart or desk.ts with
their own key, settle one market, and it shows on the receipts board
crediting their desk. That is the Oct 12 artifact.

## Assets checklist for the submission

- [ ] 2–3 min pitch video (the act structure above)
- [ ] ≤3 min demo video (desk.ts fresh-key run + Verify-this-price +
      one atomic settle on Explorer)
- [ ] Prior-work disclosure (TxODDS/Superteam, KeeperHub, AnsemHack —
      mandatory, misrepresentation = DQ)
- [ ] GTM + demand-validation write-up (this doc's GTM section)
- [ ] Team/founder section
- [ ] Registration at colosseum.com/arena (every teammate needs an account)
- [ ] Fresh-desk transcript: `.runtime/freshdesk/TRANSCRIPT.txt`
      (raw footage, desk `8BiEYkby…`, sigs in ROADMAP 2026-10-05)
