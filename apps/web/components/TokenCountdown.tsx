"use client";

import { useEffect, useState } from "react";
import { TOKEN_ENTRY_URL, TOKEN_LAUNCH_AT, TOKEN_TICKER, tokenPageUrl } from "@/lib/campaign/token";

function remaining(now: number): string {
  const diff = TOKEN_LAUNCH_AT - now;
  if (diff <= 0) return "";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * TokenCountdown — the slow-build strip. Counts down to the $STOPPAGE
 * entry-ticket launch, then swaps to the live token link once TOKEN_MINT
 * is set, then disappears. Never shows a stale countdown.
 */
export function TokenCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const live = tokenPageUrl();
  if (live) {
    return (
      <div className="token-strip" aria-label="Entry token live">
        <span><strong>{TOKEN_TICKER}</strong> is live — our Clawrena entry ticket. No utility, no promises.</span>
        <a href={live} target="_blank" rel="noreferrer">View token →</a>
      </div>
    );
  }
  const left = remaining(now);
  if (!left) return null;
  return (
    <div className="token-strip" aria-label="Token launch countdown">
      <span><strong>{TOKEN_TICKER}</strong> drops in {left} — our Clawrena entry ticket. No utility, no promises.</span>
      <a href={TOKEN_ENTRY_URL} target="_blank" rel="noreferrer">Follow the entry →</a>
    </div>
  );
}
