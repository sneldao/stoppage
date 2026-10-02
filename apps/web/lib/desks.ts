/**
 * Known operator desks — attestor/resolver pubkeys that have a public
 * identity. Multi-tenant attestation means each settle is attributable
 * to the key that signed it; naming known desks turns the proof card
 * and receipts into co-branded artifacts: the operator gets credit,
 * the protocol gets the receipt aesthetic.
 *
 * Add an entry when an operator publishes their key. Unknown keys render
 * as short pubkeys — still auditable, just anonymous.
 */
export const KNOWN_DESKS: Record<string, { name: string; note: string }> = {
  // examples/prop-desk — the stream-props operator (ATTESTOR.txt)
  DEBUEWK6DWNuCK39WQ6TJ4jHmdvdHDaMin3RgHMhr2bN: {
    name: "Punt Desk",
    note: "stream props operator",
  },
  // House attestor — secrets/attestor-keypair.json
  AeEfbMQmGUsfiQ8Bju62NTniakhsdEDykFQ7bMVw6ETQ: {
    name: "Matchkeeper",
    note: "house attestor",
  },
  // scripts/operator-quickstart.ts demo identity
  Du28nfpczwhNpQHa9DbJLWWjnXukCk1LcoFuSFM8Dguf: {
    name: "Quickstart operator",
    note: "third-party quickstart",
  },
};

export function deskNameFor(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  return KNOWN_DESKS[pubkey]?.name ?? null;
}

export function shortKey(pubkey: string | null | undefined): string {
  if (!pubkey) return "—";
  return pubkey.length > 11 ? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}` : pubkey;
}

/** Display label for whoever settled: desk name when known, short key otherwise. */
export function operatorLabelFor(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  return deskNameFor(pubkey) ?? shortKey(pubkey);
}
