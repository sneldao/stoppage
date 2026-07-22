"use client";

import { useRef, type ReactNode } from "react";
import { useInViewport } from "@/lib/dom/useInViewport";

interface LazyWhenVisibleProps {
  children: ReactNode;
  className?: string;
  minHeight?: number;
  rootMargin?: string;
}

/** Defers mounting children until the wrapper nears the viewport. */
export function LazyWhenVisible({
  children,
  className,
  minHeight,
  rootMargin = "180px",
}: LazyWhenVisibleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInViewport(ref, { rootMargin });

  return (
    <div
      ref={ref}
      className={className}
      style={minHeight ? { minHeight } : undefined}
    >
      {visible ? children : null}
    </div>
  );
}
