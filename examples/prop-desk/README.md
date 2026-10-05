# prop-desk — run your own settlement desk

A self-contained example of an **operator**: one keypair, one file, any
statement you can observe. The desk creates markets bound to the shared
attestation validator, signs its own observations, and settles them
proof-gated — the vault releases only if the ed25519 signature and the
claim verify on-chain.

This is the same path `scripts/operator-quickstart.ts` walks end-to-end;
`desk.ts` is the minimal everyday-tool version. One file, imports only
`@stoppage/sdk` and `@solana/web3.js` plus a public ESPN endpoint for
source-pinned observations.

## The trust model (say it plainly)

- The desk keypair is the whole security model. Whoever holds it can
  settle the desk's markets. Attestation is *operator-trusted by design* —
  the validator proves "this key signed this observation," not that the
  observation is true.
- Your authority is pinned on-chain: `config` PDA is seeded
  `[b"config", your_pubkey]`. Nobody else can settle through your config;
  you can't settle through anyone else's.
- Bettors who don't trust your attestations shouldn't take your markets.
  Publishing your desk pubkey (see `ATTESTOR.txt`) makes that auditable.
- `--espn <eventId>` doesn't change the trust model — you're still
  signing the claim. It means you attest to a number pulled from a
  pinned public endpoint (printed as evidence before you sign), which
  watchers can re-check themselves, instead of a number read by eye.

## Run it (devnet)

```bash
git clone https://github.com/sneldao/stoppage && cd stoppage
npm install

# generates desk-keypair.json in this folder on first use (gitignored)
# and prints your desk pubkey — publish it, it's your identity
npx tsx examples/prop-desk/desk.ts list

# fund it — devnet SOL only. Bond is ~0.05 SOL per market, refunded.
# If the public faucet errors, any devnet wallet can send you SOL.
solana airdrop 1 <your-desk-pubkey> --url devnet

npx tsx examples/prop-desk/desk.ts create \
    --slug my-first-prop --prop total_punts \
    --stat prop_count --threshold 7 --minutes 240

# when the game says 9 punts happened:
npx tsx examples/prop-desk/desk.ts settle my-first-prop --value 9

# or let the desk read a pinned ESPN box score for known props:
npx tsx examples/prop-desk/desk.ts settle my-first-prop --espn 401872972
```

The settle transaction is one bundle:
`ed25519 verify → resolve_market (validator CPI) → settle_from_proof →
attest`. If your signature or claim fails verification, the whole thing
reverts. There is no authority-only settle path.

## Watch + pending

```bash
# open markets past closes_at — exit 1, optional ALERT_WEBHOOK_URL post.
# Cron it (e.g. */5 * * * * during your slate) and it pages instead of
# silently aging markets.
npx tsx examples/prop-desk/desk.ts pending

# one ESPN event → proposals for every open prop with an extractor,
# each with the evidence detail you'd be signing. Dry-run by default.
npx tsx examples/prop-desk/desk.ts watch --espn 401872972

# reviewed the proposals? --yes signs and settles each atomically.
npx tsx examples/prop-desk/desk.ts watch --espn 401872972 --yes
```

`ESPN_EXTRACTORS` covers the shared conventions (`total_punts`,
`sacks`, `fourth_down_conv`, `pick_six`). Props without an extractor
are skipped with a pointer to `--value` — feed-free claims are the
product's reason to exist. Add your own extractors the same way you
claim stat keys.

## Claim your own stat keys

`STAT_KEYS` in `desk.ts` is your registry — the validator treats the key
as opaque bytes bound into the signed message. `1–4` are house/shared
conventions (`total_goals`, `price_usd_e8`, `prop_count`, `prop_bool`).
Pick your own range for anything else and publish it, so watchers know
what `statKey=42` means when they audit your settles.

## The Punt Desk (our instance)

We run this file as **Punt Desk** on Sundays — live stream props settled
mid-game under attestor `ATTESTOR.txt`. Same deployed validator, different
authority. Watch its markets settle, then run your own.
