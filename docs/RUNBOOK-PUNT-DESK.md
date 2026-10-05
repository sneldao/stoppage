# Punt Desk runbook — Sunday Oct 4, 2026

Operator ops for the four pre-staged devnet props. Everything here is
`examples/prop-desk/desk.ts` against devnet; the desk key
(`DEBUEWK6DWNuCK39WQ6TJ4jHmdvdHDaMin3RgHMhr2bN`, `desk-keypair.json` in
the example dir) is payer + attestor.

## The slate

| slug | statement | market PDA | stat |
|---|---|---|---|
| sun-punts | total punts over 7 | `E9wkw4LQeGTiuXp4Gw3E7kCowJZkFZGqVN4i5mXMjCCU` | prop_count |
| sun-sacks | sacks over 3 | `24MHq3vMGTo6k5sbrpTcpK4nckeeGhNQqHQMzEdvTUs7` | prop_count |
| sun-4dc | a 4th-down conversion happens ≥1 | `13LcqjuCo1CyVhYx6RqjWKoeWSKmLdm2WnXoQHfFxMra` | prop_bool |
| sun-pick6 | a pick-six happens ≥1 | `4w6pssZvqQsqucA47QgMhcDSCX6ReE1asWvjLQGTYqeA` | prop_bool |

All four close betting Sun Oct 4 23:00 UTC. `settle_from_proof` has no
closes gate — settle any time once the observation is knowable;
mid-window settling is the demo, not a bug.

## Live state check

```bash
cd examples/prop-desk
npx tsx desk.ts list
```

## Observing

Pick one reference game (or the slate) and pin the source *before*
settling — the observation you sign is the claim, so quote it. Good
enough for devnet:

- **punts / sacks** — ESPN or NFL box score, team stats page.
- **4th-down conversion / pick-six** — ESPN play-by-play; search for
  "4th and" conversions and pick-six scoring plays.

Write the chosen scope in your head before you sign: the statement
doesn't encode game scope, the desk's word does.

## Settling

All four props have ESPN extractors now — pin the event and let the desk
propose, or pass the observed integer yourself:

```bash
# dry-run: prints observed value + evidence detail per open prop
npx tsx desk.ts watch --espn <eventId>

# reviewed? sign and settle each atomically
npx tsx desk.ts watch --espn <eventId> --yes

# manual path unchanged (feed-free props, or you disagree with the feed)
npx tsx desk.ts settle sun-punts --value 9
npx tsx desk.ts settle sun-punts --espn <eventId>
```

**Pager during the slate:** `npx tsx desk.ts pending` exits 1 when a
market is open past `closes_at` — cron it at `*/5` during the slate (set
`ALERT_WEBHOOK_URL` for a push). Oct 4 sat open ~20h without it.

Each call is the full proof-gated bundle: ed25519 observation signature →
`resolve_market` → `settle_from_proof` → `attest_verification`, atomic.
The settle tx signature is the receipt — keep it.

## After settle

- Bond comes back with `npx tsx ../../scripts/sweep-bonds.ts desk-keypair.json`
- The settled market's proof card ("Download card" on its market page or
  /receipts) is the share artifact — it credits Punt Desk by name.
- My 0.05 YES on sun-punts means a real claim → card moment exists if
  it lands YES.

## Failure modes

- **`BeforeReference`**: never happens here — `referenceTs` was set at
  creation; any observation now is after it.
- **Desk wallet empty**: needs ~0.01 SOL/settle + sweep fee. Check
  `solana balance` first; `solana airdrop` is the fallback.
- **Registry lost**: settle takes a market PDA instead of a slug —
  `npx tsx desk.ts settle <pda> --value N` still works IF a registry
  entry exists for it (the entry carries op/threshold/referenceTs —
  without it there's no claim to sign). `.desk-registry.json` is the
  desk's book; don't lose it. The on-chain market is the source of
  truth for settlement state, not for what you claimed.
- **No extractor**: `watch`/`--espn` cover the shared prop conventions
  only. A feed-free prop settles with `--value` — that's the feature.
