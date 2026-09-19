/**
 * ExpectationsStrip — pre-launch delineation for token visitors
 * (hackathons.md §3 caveats). What the build is (devnet, receipts
 * on-chain) and what the token is (Clawrena entry ticket, no promised
 * utility) — stated plainly before anyone asks.
 */
export function ExpectationsStrip() {
  return (
    <p className="expectations" aria-label="Status and expectations">
      <span>
        <b>Devnet</b> test funds — every settle leaves an on-chain receipt
      </span>
      <span>
        <b>Token</b> launching as our AnsemHack entry — an entry ticket, not a
        claim on the protocol · no promised utility
      </span>
    </p>
  );
}
