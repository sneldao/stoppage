import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hold the board — self-serve proof-gated settlement",
  description:
    "Bring the market and the oracle. Pin your own attestor, sign the observation, and the vault releases only if the proof verifies. Multi-tenant attestation validator on Solana devnet.",
  openGraph: {
    type: "website",
    url: "https://stoppage.sportwarren.com/operators",
    title: "Hold the board — Stoppage for operators",
    description:
      "Self-serve proof-gated settlement: your key, your proof, the vault releases. Multi-tenant attestation validator on devnet.",
    images: [
      {
        url: "/campaign/selfserve-og.jpg",
        width: 1200,
        height: 630,
        alt: "Stoppage — hold the board: your key, your proof, the vault releases",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hold the board — Stoppage for operators",
    description:
      "Self-serve proof-gated settlement: your key, your proof, the vault releases. Multi-tenant attestation validator on devnet.",
    images: ["/campaign/selfserve-og.jpg"],
  },
};

export default function OperatorsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
