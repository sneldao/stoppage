"use client";

import { useEffect, useState, type RefObject } from "react";

/** True when the element intersects the viewport (with optional margin). */
export function useInViewport(
  ref: RefObject<Element | null>,
  options?: { rootMargin?: string; initial?: boolean }
) {
  const [inView, setInView] = useState(options?.initial ?? false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { rootMargin: options?.rootMargin ?? "80px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, options?.rootMargin]);

  return inView;
}
