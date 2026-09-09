# Stoppage — UI Copy Glossary

Single source of truth for how concepts are named in the betting UI. The
product has **two audiences** — bettors (the reference UI) and operators
(the settlement layer). Bettor-facing copy stays plain and emotional; the
precise protocol terms belong to operator-facing copy and docs. If a term
drifts here, it drifts in the product.

## Audience split

| Audience | | Language |
|---|---|---|
| **Bettor** (reference UI) | | Plain, no Merkle / CPI / PDA / rent / lamports. "The result is proven on-chain." |
| **Operator** (operators page, docs) | | Precise protocol terms: validator program, receipt PDA, Merkle proof, CPI, session grant. |

## One term per concept

| Concept | User-facing term | Internal / operator term | Notes |
|---|---|---|---|
| Session-key betting | **"One-tap betting"** | "session key", "SessionGrant" | Never "Fast Session" in UI copy. |
| open market | **"Open"** | `open` | |
| awaiting_settlement | **"Settling"** | `awaiting_settlement` | Also "Validating now…" on the proof path. |
| settled | **"Resolved"** | `settled` | |
| void | **"Void"** | `void` | "Refund path" is the user-facing consequence. |
| Quant market-maker | **"model" / "fair value"** | "Matchkeeper" | Keep "Matchkeeper" only as the branded agent name where personality is wanted. |
| Settlement guarantee | **"the result is proven on-chain"** | "proof-gated settlement", "receipt PDA" | |
| Session fund | **"the 0.1 SOL that covers stakes + fees"** | "fund_lamports" | Never expose internal fund mechanics in a tooltip. |
| Revoke | **"End session"** | "revoke_session_key" | "Self-exclude" only where the honest consequence matters. |
| Validator / oracle | **"the result's proof"** | "TxLINE / Pyth / operator attestor validator" | |

## Honesty rules (do not soften)

- **Operator-attested** markets must always say "operator-attested" and
  never imply TxODDS- or network-verification. See ATTESTATION-ORACLE.md.
- Devnet is labeled honestly ("Devnet test funds") in setup; the hero lede
  may speak aspirationally as long as the footer carries "Built on Solana devnet."
- Never ship an unfinished-backend note to a user ("not yet sweepable via
  the UI — follow-up"). If a capability is missing, say what the user can
  do, not what the code can't yet.

## Motion & voice

- Keep the stadium / stoppage-time motif in naming (StoppageClock,
  StadiumDial, "deep in stoppage time" 404). It is the brand's personality.
- Copy tone adapts to consequence: calm for routine success, warm but
  direct for risk (betting, revoke), never joking about money or loss.
