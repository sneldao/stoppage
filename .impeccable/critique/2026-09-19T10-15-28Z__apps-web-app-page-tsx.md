---
target: homepage
total_score: 29
max_score: 36
na_heuristics: 7
p0_count: 2
p1_count: 1
timestamp: 2026-09-19T10-15-28Z
slug: apps-web-app-page-tsx
---
## Design Health Score — homepage (29/36, strong with specific gaps)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | LIVE badge, market counts, ticker all present — but the agent that *is* the system is invisible |
| 2 | Match System / Real World | 3 | Football markets read naturally; "Match SOL/USD:1785272400" mislabels price contracts as matches |
| 3 | User Control and Freedom | 3 | Clear connect/bet path; ONE-TAP marked optional; pause/revoke flows exist per rules |
| 4 | Consistency and Standards | 4 | Coherent dark editorial system, consistent mono label typography |
| 5 | Error Prevention | 4 | Honest "awaiting match data" gate on unverifiable markets; small default stakes |
| 6 | Recognition Rather Than Recall | 3 | Plain-language nav; Pyth market IDs require decoding |
| 7 | Flexibility and Efficiency | n/a | Persuade surface — not scored |
| 8 | Aesthetic and Minimalist Design | 4 | Distinctive editorial voice (Instrument Serif display + mono labels), not generic |
| 9 | Error Recovery | 3 | Honest degraded states observed |
| 10 | Help and Documentation | 2 | No "what/who/why" surface for evaluators; keystone receipts exist but aren't signposted as the credibility artifact |

## Design Specificity Verdict

LLM assessment: authored, not interchangeable. The editorial serif + mono-label system, the pixel-grid texture, and the proof-first copy ("never on anyone's say-so") give it real product character. The gap is narrative, not visual: the surface tells a betting-app story while the thing being entered into the Clawrena is an autonomous market operator.

Deterministic scan: 1 finding — `overused-font` warning on globals.css. Likely false positive: Instrument Serif display face + Manrope body is a distinctive pairing, not the slop-font pattern the rule targets.

## Priority Issues

- [P0] The agent is invisible on the landing surface. Fix: homepage strip sourced from the match-events ledger — "Matchkeeper: N markets created · M settled by proof · last action … · paid 0.0006 SOL for a judgment call (x402)". Suggested command: $impeccable shape
- [P0] No expectation-delineation surface for token visitors. Fix: extend the "DEVNET TEST FUNDS" line into a proper expectations row: devnet test funds · receipts on-chain · token = hackathon entry, no promised utility. Suggested command: $impeccable clarify
- [P1] The market tape reads as bot noise — identical "Price above $74 on SOL/USD:xxxx" rows bury real football markets and look manufactured to judges checking volume claims. Fix: sports-first ordering, collapse Pyth contracts under a grouped toggle, label them "price markets". Suggested command: $impeccable distill
- [P2] "Match" used for non-match price contracts in grouping headers — rename per UX-GLOSSARY to "contract"/"price market". Suggested command: $impeccable clarify
- [P2] Keystone receipts card is the strongest credibility artifact but renders below the featured market on desktop. Suggested command: $impeccable layout

## Persona Red Flags

**Skeptical evaluator (judge/token researcher):** lands on a betting app; no agent identity, no receipts link in the hero zone, tape looks machine-generated → discounts "onchain volume" claims. Drops before discovering /operators or /keystone.
**First-time bettor:** cleanest path in the app — 3 numbered steps, small stakes, honest gating. Works.
**Operator:** /operators page is the strongest surface ("funds move on a bool — not a key"); but only reachable via nav, not signposted from the hero.

## What's Working

- Differentiator in the hero copy itself — "proven on-chain — never on anyone's say-so" is the pitch, unmissable
- Devnet honesty already present in three places (hero eyebrow, footer, "use only where permitted")
- /keystone + /operators are genuinely excellent receipts/infra surfaces — the raw material is all there
