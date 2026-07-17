# Security Policy

## Devnet scope

This project is built for the TxODDS World Cup track (Superteam Earn)
and runs on **Solana devnet only**. No real value is at stake. The
security measures below are appropriate for hackathon scope and should
be reviewed before any mainnet deployment.

## Reporting a vulnerability

If you discover a security issue, please open a private GitHub Security
Advisory rather than a public issue. Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

## Known security considerations

### Program keypairs in git

Devnet program keypairs (`keys/*-keypair.json`) are intentionally
committed to ensure consistent program IDs across all deployments.
A program keypair is **not** the upgrade authority — after first deploy,
upgrades require the deployer wallet (`~/.config/solana/id.json`), not
these files. **Before any mainnet deployment, generate fresh keypairs
that are not in git history.**

### Session keys

Session keys are ephemeral keypairs generated client-side and stored in
`sessionStorage`. They are funded with a limited amount of SOL and
scoped to the market program only. The key material is in plain text
in browser storage — acceptable for devnet, but for mainnet, consider
encrypting with a user-provided password or using a hardware-backed
keystore.

### TxLINE credentials

TxLINE JWT and API token are saved to `.txline-credentials.json` (gitignored,
file permissions 600). These credentials are read-only data feed tokens —
they cannot move SOL or interact with the market program.

### Pre-commit hook

A pre-commit hook (`scripts/pre-commit.sh`) scans staged files for:
- JWT tokens, API keys, PEM private keys
- Forbidden files (`.env`, `.txline-credentials.json`, etc.)
- Program-ID consistency (when program files are touched)

Install with: `./scripts/install-hooks.sh`

### Dependency vulnerabilities

`npm audit` reports vulnerabilities in transitive dependencies of
`@solana/wallet-adapter-wallets` and `@solana/spl-token` (upstream
Solana ecosystem issues). These cannot be fixed without breaking
changes and are tracked upstream. No direct dependencies have known
vulnerabilities.
