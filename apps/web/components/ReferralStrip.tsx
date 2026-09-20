"use client";

import { useStoppageStore } from "@/store";

function shortWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/**
 * ReferralStrip — closes the viral loop visibly. The sharer sees their
 * share count (their link carries their wallet); a referred visitor sees
 * who brought them. Join counts across devices are unknowable without a
 * backend, so this shows exactly what is known — no vanity numbers.
 */
export function ReferralStrip() {
  const sharesCount = useStoppageStore((s) => s.sharesCount);
  const referrer = useStoppageStore((s) => s.referrer);

  if (sharesCount === 0 && !referrer) return null;

  return (
    <section className="referral-strip" aria-label="Referral chain">
      <p className="eyebrow">Your chain</p>
      {sharesCount > 0 && (
        <p className="referral-line">
          Shared <strong>{sharesCount}×</strong> · your link carries your wallet — every call placed through it extends your chain.
        </p>
      )}
      {referrer && (
        <p className="referral-line referral-line--joined">
          You joined via <strong>{shortWallet(referrer)}</strong> · their chain brought you here.
        </p>
      )}
    </section>
  );
}
