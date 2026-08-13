import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orlando City v FC Cincinnati — two markets, two proof paths",
  description:
    "Sat 23:30 UTC: the same MLS fixture settles two ways — a TxLINE Merkle-proof market and an operator-attested market. Betting opens 21:30 UTC. Proof-gated settlement on Solana devnet.",
  openGraph: {
    type: "website",
    url: "https://stoppage.sportwarren.com/keystone",
    title: "One match, two truth paths — Stoppage keystone",
    description:
      "Orlando City v FC Cincinnati, Saturday: one market settles on a TxLINE Merkle proof, one on an operator attestation. Same contract, both verifiable.",
    images: [{ url: "/og-image.png?v=2", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "One match, two truth paths — Stoppage keystone",
    description:
      "Orlando City v FC Cincinnati, Saturday: one market settles on a TxLINE Merkle proof, one on an operator attestation. Same contract, both verifiable.",
    images: ["/og-image.png?v=2"],
  },
};

export default function KeystoneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
