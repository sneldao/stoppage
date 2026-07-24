# Oracle-Agnostic Settlement Implementation

This document summarizes the changes made to support multiple oracles in the settlement program.

## Overview

The settlement program is now **oracle-agnostic** - it no longer hardcodes TxLINE program IDs or account structures. Instead, the validator program and anchor accounts are passed as remaining accounts, allowing any oracle that returns a boolean result to be used.

## Program Changes

### Settlement Program (`programs/settlement/src/lib.rs`)

**Key Changes:**
- Removed hardcoded `TXLINE_PROGRAM_ID_DEVNET` and `TXLINE_PROGRAM_ID_MAINNET` constants
- Removed `daily_scores_roots` from the accounts struct
- Validator program ID is now passed as the **first remaining account**
- Anchor accounts (e.g., `daily_scores_roots` for TxLINE) are passed as **subsequent remaining accounts**
- All CPI calls now use the dynamically provided validator program ID
- Updated event structure to include `validator_program: Pubkey`
- Updated error codes to be oracle-agnostic

**Account Structure:**
```rust
#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub resolution: Account<'info, Resolution>,
    #[account(mut)]
    pub resolver: Signer<'info>,
    // remaining_accounts:
    //   [0] validator_program (e.g., TxLINE program)
    //   [1..] anchor_accounts (e.g., daily_scores_roots for TxLINE)
}
```

**CPI Data:**
- `validator_ix_data` now includes the **complete instruction data** (8-byte discriminator + args)
- The settlement program no longer prepends the discriminator

### Market Program (`programs/market/src/lib.rs`)

**Key Changes:**
- `Market` struct now includes `oracle: Pubkey` field
- `oracle` field is set during market creation
- `settle_from_proof` validates that the resolution's validator matches the market's oracle
- Updated `verify_resolution_receipt` to check `validator_program` at offset 41-73
- Added `ResolutionOracleMismatch` error code

**Market Account Layout:**
```rust
pub struct Market {
    // ... existing fields ...
    pub oracle: Pubkey,  // NEW: validator program ID
    // ... rest of fields ...
}
```

## SDK Changes (`packages/sdk/src/settlement.ts`)

**New Functions:**

1. **`buildResolveMarketIx`** - Oracle-agnostic resolve instruction builder
   ```typescript
   function buildResolveMarketIx(
     resolver: PublicKey,
     market: PublicKey,
     validatorProgram: PublicKey,  // Oracle program ID
     validatorAccounts: PublicKey[],  // Anchor accounts
     statement: string,
     merkleRoot: Uint8Array,
     outcome: 0 | 1,
     validatorIxData: Buffer  // Complete instruction data with discriminator
   ): TransactionInstruction
   ```

2. **`buildTxlineValidateStatData`** - Builds complete TxLINE instruction data with discriminator
   ```typescript
   function buildTxlineValidateStatData(params: ValidateStatParams): Buffer
   ```
   - Returns discriminator (8 bytes) + serialized args
   - Used by TxLINE oracle adapter

**Removed Functions:**
- `buildValidateStatData` (replaced by `buildTxlineValidateStatData` which includes discriminator)

## Oracle Adapter Changes (`packages/sdk/src/oracle.ts`)

**Key Changes:**
- `OracleVerifySpec` now has `instructionData` (complete) instead of `instructionArgs` (without discriminator)
- `txlineOracle.buildVerifySpec` uses `buildTxlineValidateStatData` to include discriminator
- `genericOracle.buildVerifySpec` expects caller to provide complete instruction data
- Updated `buildResolveMarketIxFromOracle` to use new signature

**Oracle Interface:**
```typescript
interface OracleVerifySpec {
  validatorProgram: PublicKey;
  anchorAccounts: PublicKey[];
  instructionData: Buffer;  // Complete: discriminator + args
  merkleRoot: Uint8Array;
}
```

## Web App Changes (`apps/web/app/`)

### `hooks/useCreateMarket.ts`
- Added `oracle` parameter (default: `DEFAULT_ORACLE` from SDK)
- Passes oracle to `buildCreateMarketIx`

### `hooks/useSettleMarket.ts`
- Uses oracle adapter pattern to build resolve instruction
- Passes validator program and anchor accounts via remaining_accounts
- Uses `buildTxlineValidateStatData` for TxLINE oracle

### `components/MarketList.tsx`
- Displays market's oracle (validator program ID) in market details

### `lib/marketUtils.ts`
- Updated `parseMarket` to extract `oracle` field at offset 145-177

## Demo Scripts

### `scripts/create-demo-market.ts`
- Uses `DEFAULT_ORACLE` (TxLINE devnet)
- Updated to use new `buildResolveMarketIx` signature

### `scripts/create-proof-board-demo.ts`
- Uses `DEFAULT_ORACLE` for market creation
- Updated settlement logic to use oracle adapter pattern

## Migration Guide

### For Existing Markets

Old markets (without oracle field) will not be compatible with the new settlement program. You must:
1. Create new markets with the oracle field specified
2. Use the new settlement program ID (after deployment)

### For New Markets

When creating a market, specify the oracle:
```typescript
const ix = buildCreateMarketIx({
  creator: wallet.publicKey,
  predicate: myPredicate,
  closesAt: Date.now() / 1000 + 3600,
  oracle: DEFAULT_ORACLE,  // or custom oracle
});
```

### For Custom Oracles

Implement the oracle adapter:
```typescript
const myOracle: SettlementOracle = {
  id: "my-oracle",
  validatorProgram: MY_PROGRAM_ID,
  buildVerifySpec: async (market, proof) => {
    // Build complete instruction data (discriminator + args)
    const instructionData = buildMyOracleInstructionData(proof);
    return {
      validatorProgram: MY_PROGRAM_ID,
      anchorAccounts: [myAnchorAccount],
      instructionData,  // Must include discriminator
      merkleRoot: proof.merkleRoot,
    };
  },
};
```

## Deployment Steps

1. **Build Programs:**
   ```bash
   npm run anchor:build
   ```

2. **Deploy to Devnet:**
   ```bash
   npm run anchor:deploy -- --provider.cluster devnet
   ```

3. **Update SDK IDLs:**
   ```bash
   # IDLs are automatically updated by anchor build
   # Commit the updated IDL files
   ```

4. **Test with Demo Script:**
   ```bash
   npx tsx scripts/create-demo-market.ts
   ```

## Verification Checklist

- [ ] Settlement program compiles without TxLINE hardcoding
- [ ] Market program includes oracle field
- [ ] SDK builds resolve instructions with validator accounts
- [ ] SDK builds TxLINE instruction data with discriminator
- [ ] Web app creates markets with oracle parameter
- [ ] Web app settles markets using oracle adapter
- [ ] Demo scripts work with new API
- [ ] Custom oracle can be implemented and used

## Testing

Test with the updated demo script:
```bash
npx tsx scripts/create-demo-market.ts
```

The script will:
1. Create a market with `DEFAULT_ORACLE` (TxLINE devnet)
2. Fetch TxLINE validation proof
3. Build complete instruction data with discriminator
4. Resolve market via settlement program
5. Settle market and verify oracle binding

## Benefits

1. **Flexibility:** Support any oracle that returns boolean results
2. **Extensibility:** Add new oracles without modifying settlement program
3. **Security:** Market-oracle binding prevents cross-oracle attacks
4. **Maintainability:** Oracle-specific logic moves to TypeScript adapters
