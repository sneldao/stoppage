"use client";

import { useEffect, useState } from "react";

let pageVisible = typeof document === "undefined" ? true : !document.hidden;
let initialized = false;
const listeners = new Set<(visible: boolean) => void>();

function notify() {
  for (const listener of listeners) listener(pageVisible);
}

function initVisibility() {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  pageVisible = !document.hidden;
  document.body.classList.toggle("page-hidden", !pageVisible);
  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
    document.body.classList.toggle("page-hidden", !pageVisible);
    notify();
  });
}

/** Tracks whether the tab is visible. Also toggles `body.page-hidden`. */
export function usePageVisible() {
  const [visible, setVisible] = useState(pageVisible);

  useEffect(() => {
    initVisibility();
    setVisible(pageVisible);
    listeners.add(setVisible);
    return () => { listeners.delete(setVisible); };
  }, []);

  return visible;
}
