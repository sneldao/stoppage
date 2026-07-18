"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useSessionKey } from "@/lib/session-key/useSessionKey";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-32" /> }
);

const routes = [
  { href: "/", label: "Match desk" },
  { href: "/match", label: "Match room" },
  { href: "/markets", label: "Market tape" },
];

export function InstrumentNav() {
  const pathname = usePathname();
  const { state } = useSessionKey();

  return (
    <header className="app-nav instrument-nav">
      <Link href="/" className="wordmark" aria-label="Stoppage match desk">STOPPAGE<span>.</span></Link>
      <nav className="nav-routes" aria-label="Primary navigation">
        {routes.map((route) => {
          const active = route.href === "/" ? pathname === "/" : pathname.startsWith(route.href);
          return <Link className={`nav-route ${active ? "active" : ""}`} href={route.href} key={route.href} aria-current={active ? "page" : undefined}>{route.label}</Link>;
        })}
      </nav>
      <Link href="/#fast-setup" className="nav-session nav-session-link" title={state.expiresAt ? `Session expires ${new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Set up a scoped Fast Session"}><i className={state.delegated ? "live-dot" : "schedule-dot"} /> {state.delegated ? "Fast on" : "Fast setup"}</Link>
      <div className="nav-wallet"><WalletMultiButton /></div>
    </header>
  );
}
