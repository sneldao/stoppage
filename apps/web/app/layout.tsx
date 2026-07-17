import type { Metadata } from "next";
import { WalletContextProvider } from "@/components/WalletProvider";
import { ReferralInit } from "@/components/ReferralInit";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stoppage — markets that live inside the match",
  description:
    "In-play sports micro-markets with session-key betting and verifiable settlement, on Solana.",
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
          {children}
        </WalletContextProvider>
      </body>
    </html>
  );
}
