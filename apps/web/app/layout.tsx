import type { Metadata } from "next";
import { WalletContextProvider } from "@/components/WalletProvider";
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
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
