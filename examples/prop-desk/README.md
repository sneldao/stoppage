# prop-desk — run your own settlement desk

A self-contained example of an **operator**: one keypair, one file, any
statement you can observe. The desk creates markets bound to the shared
attestation validator, signs its own observations, and settles them
proof-gated — the vault releases only if the ed25519 signature and the
claim verify on-chain.

This is the same path `scripts/operator-quickstart.ts` walks end-to-end;
`desk.ts` is the minimal everyday-tool version. ~200 lines, imports only
`@stoppage/sdk` and `@solana/web3.js`.

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
```

The settle transaction is one bundle:
`ed25519 verify → resolve_market (validator CPI) → settle_from_proof →
attest`. If your signature or claim fails verification, the whole thing
reverts. There is no authority-only settle path.

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
