# Program keypairs (devnet)

These keypairs define the program *addresses* — they are the single source
of truth for program IDs across the repo (`scripts/check-ids.js` enforces
this, `scripts/sync-ids.js` propagates them).

Committing them is deliberate: it guarantees every clone and every deploy
targets the same addresses, which is the failure mode that repeatedly broke
the predecessor project (three divergent program IDs across code, docs, and
env templates).

Security note: a program keypair is NOT the upgrade authority — after first
deploy, upgrades require the deployer wallet, not these files. Fine for
devnet/hackathon scope. **Before any mainnet deployment, generate fresh
keypairs that are not in git history.**
