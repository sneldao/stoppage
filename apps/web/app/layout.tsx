import type { Metadata } from "next";
import { WalletContextProvider } from "@/components/WalletProvider";
import { ReferralInit } from "@/components/ReferralInit";
import { InstrumentNav } from "@/components/InstrumentNav";
import { RouteFrame } from "@/components/RouteFrame";
import { LivePnLStrip } from "@/components/LivePnLStrip";
import { ActivitySurfaces } from "@/components/ActivitySurfaces";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stoppage.sportwarren.com"),
  applicationName: "Stoppage",
  title: {
    default: "Stoppage — bet the next moment",
    template: "%s — Stoppage",
  },
  description:
    "In-play sports micro-markets with session-key betting, TxLINE proofs, and verifiable Solana settlement.",
  keywords: [
    "Stoppage",
    "TxLINE",
    "TxODDS",
    "Solana",
    "prediction markets",
    "sports data",
    "verifiable settlement",
  ],
  icons: {
    icon: [
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-512x512.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: "https://stoppage.sportwarren.com",
    siteName: "Stoppage",
    title: "Stoppage — bet the next moment",
    description:
      "Session-key betting, TxLINE Merkle proofs, and proof-gated Solana settlement for in-play sports micro-markets.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Stoppage: markets that live inside the match",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stoppage — bet the next moment",
    description:
      "Session-key betting, TxLINE proofs, and verifiable Solana settlement for in-play sports micro-markets.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletContextProvider>
          <ReferralInit />
          <InstrumentNav />
          <LivePnLStrip />
          <RouteFrame>{children}</RouteFrame>
          <ActivitySurfaces />
        </WalletContextProvider>
      </body>
    </html>
  );
}
