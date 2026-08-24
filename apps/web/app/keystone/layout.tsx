import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The keystone — proof held, staked settle paid",
  description:
    "Chapter 1: the Aug 15 MLS fixture settled by a live TxLINE Merkle proof, on-chain, in one transaction. Chapter 2: Arsenal v Coventry — the same proof path with real stakes, winner paid, vault drained. Solana devnet.",
  openGraph: {
    type: "website",
    url: "https://stoppage.sportwarren.com/keystone",
    title: "Proof-gated settlement that held — Stoppage keystone",
    description:
      "Two matches, two TxLINE Merkle proofs, real stakes on the second. When the match settles, the proof gates the payout in the same transaction. No admin key decides anything.",
    images: [{ url: "/campaign/receipt-og.jpg", width: 1200, height: 630, alt: "Stoppage — the proof held: settled by TxLINE Merkle proof" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof-gated settlement that held — Stoppage keystone",
    description:
      "Two matches, two TxLINE proofs, real stakes on the second. The proof gates the payout in the same transaction — no admin key.",
    images: ["/campaign/receipt-og.jpg"],
  },
};

export default function KeystoneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
