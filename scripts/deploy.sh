#!/usr/bin/env bash
# Canonical deploy pipeline. The ONLY supported way to deploy.
#
#   1. Assert all program-ID sources agree (fails fast on drift)
#   2. Copy source-of-truth keypairs into target/deploy so anchor
#      deploys to the canonical addresses
#   3. anchor build
#   4. Copy fresh IDLs into packages/sdk/idl/ (the only place the
#      frontend/SDK ever loads an IDL from)
#   5. anchor deploy to devnet
#
# Lesson from pir8: never let the deployed program, the IDL the client
# loads, and the configured program ID come from different builds.

set -euo pipefail
cd "$(dirname "$0")/.."

# Homebrew's plain cargo shadows the rustup shim and cannot handle the
# `cargo +solana` toolchain directive anchor uses. Put rustup's bin first.
export PATH="$HOME/.cargo/bin:$PATH"

echo "── 1/5 checking program-ID consistency"
node scripts/check-ids.js

echo "── 2/5 installing canonical keypairs into target/deploy"
mkdir -p target/deploy
cp keys/market-keypair.json target/deploy/market-keypair.json
cp keys/settlement-keypair.json target/deploy/settlement-keypair.json

echo "── 3/5 anchor build"
anchor build

echo "── 4/5 syncing IDLs into packages/sdk/idl/"
mkdir -p packages/sdk/idl
cp target/idl/market.json packages/sdk/idl/market.json
cp target/idl/settlement.json packages/sdk/idl/settlement.json

echo "── 5/5 anchor deploy (devnet)"
anchor deploy --provider.cluster devnet

echo
echo "Deployed. Verify with:"
echo "  solana program show $(solana-keygen pubkey keys/market-keypair.json) --url devnet"
echo "  solana program show $(solana-keygen pubkey keys/settlement-keypair.json) --url devnet"
