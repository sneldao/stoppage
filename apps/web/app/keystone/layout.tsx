import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The keystone — proof held, next: the first staked settle",
  description:
    "Chapter 1: the Aug 15 MLS fixture settled by a live TxLINE Merkle proof, on-chain, in one transaction. Chapter 2: Arsenal v Coventry — the same proof path with a real stake. Solana devnet.",
  openGraph: {
    type: "website",
    url: "https://stoppage.sportwarren.com/keystone",
    title: "Proof-gated settlement that held — Stoppage keystone",
    description:
      "One market, one TxLINE Merkle proof path, your stake on the line. When the match settles, the proof gates the payout in the same transaction. No admin key decides anything.",
    images: [{ url: "/campaign/og.jpg", width: 1200, height: 630, alt: "Stoppage — the proof is the authority" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof-gated settlement that held — Stoppage keystone",
    description:
      "One market, one TxLINE proof path, your stake on the line. The proof gates the payout in the same transaction — no admin key.",
    images: ["/campaign/og.jpg"],
  },
};

export default function KeystoneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
