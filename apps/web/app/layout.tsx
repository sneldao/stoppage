import type { Metadata } from "next";
import { WalletContextProvider } from "@/components/WalletProvider";
import { ReferralInit } from "@/components/ReferralInit";
import { InstrumentNav } from "@/components/InstrumentNav";
import { RouteFrame } from "@/components/RouteFrame";
import { ChainMonitor } from "@/components/ChainMonitor";
import { AppMonitors } from "@/components/AppMonitors";
import { LivePnLStrip } from "@/components/LivePnLStrip";
import { ActivitySurfaces } from "@/components/ActivitySurfaces";
import { OddsMovementAlerts } from "@/components/OddsMovementAlerts";
import { StadiumDial } from "@/components/StadiumDial";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stoppage.sportwarren.com"),
  applicationName: "Stoppage",
  title: {
    default: "Stoppage — markets that settle on proof",
    template: "%s — Stoppage",
  },
  description:
    "Oracle-agnostic settlement for prediction markets: proof-gated payouts, session-key UX, and verifiable receipts on Solana.",
  keywords: [
    "Stoppage",
    "Solana",
    "prediction markets",
    "decision markets",
    "futarchy",
    "oracle-agnostic settlement",
    "verifiable settlement",
    "Pyth",
    "TxLINE",
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
    title: "Stoppage — markets that settle on proof",
    description:
      "Proof-gated settlement on Solana. Any validator oracle, one verifiable receipt. Session-key UX, no signing popups.",
    images: [
      {
        url: "/og-image.png?v=2",
        width: 1200,
        height: 630,
        alt: "Stoppage: markets that settle on proof, not trust",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stoppage — markets that settle on proof",
    description:
      "Oracle-agnostic settlement for prediction markets. Any validator, one verifiable receipt, on Solana.",
    images: ["/og-image.png?v=2"],
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
          <StadiumDial />
          <ChainMonitor />
          <AppMonitors />
          <InstrumentNav />
          <LivePnLStrip />
          <RouteFrame>{children}</RouteFrame>
          <ActivitySurfaces />
          <OddsMovementAlerts />
        </WalletContextProvider>
      </body>
    </html>
  );
}
