"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function routeDepth(from: string, to: string) {
  const fromMarket = from.startsWith("/markets/");
  const toMarket = to.startsWith("/markets/");
  if (toMarket && !fromMarket) return "route-enter-detail";
  if (fromMarket && to === "/markets") return "route-return-tape";
  if (to === "/markets") return "route-enter-tape";
  return "route-enter-desk";
}

export function RouteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const depth = routeDepth(previousPathname.current, pathname);

  useEffect(() => {
    previousPathname.current = pathname;
  }, [pathname]);

  return <div className={`route-frame ${depth}`} key={pathname}>{children}</div>;
}
