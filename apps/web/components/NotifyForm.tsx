"use client";

import { useState } from "react";
import Link from "next/link";
import { keystoneCalendarHref } from "@/lib/campaign/keystone";

/**
 * Formspree endpoint for the keystone "notify me" lead capture.
 * Create the form at https://formspree.io, then set this (or the
 * NEXT_PUBLIC_FORMSPREE_ID env var, which takes precedence). Until it's
 * configured the component renders the calendar-link fallback instead —
 * the page never shows a form that submits into nowhere.
 */
const FORMSPREE_ID =
  process.env.NEXT_PUBLIC_FORMSPREE_ID ?? "YOUR_FORM_ID";

const FORMSPREE_URL = `https://formspree.io/f/${FORMSPREE_ID}`;
const IS_CONFIGURED = !FORMSPREE_ID.includes("YOUR_FORM_ID");

type NotifyState = "idle" | "sending" | "done" | "error";

/**
 * "Notify me when betting opens" — the campaign's lead capture (Formspree:
 * zero backend code; leads land in the Formspree dashboard + email).
 * Honest microcopy: devnet SOL, receipts on-chain, one email before
 * kickoff and one when the receipts land.
 */
export function NotifyForm() {
  const [state, setState] = useState<NotifyState>("idle");

  if (!IS_CONFIGURED) {
    return (
      <div className="keystone-notify keystone-notify--fallback">
        <p className="eyebrow">Don&apos;t miss kickoff</p>
        <a href={keystoneCalendarHref()} download="stoppage-keystone.ics" className="keystone-calendar-cta">
          Add kickoff to calendar (.ics) <span>→</span>
        </a>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get("email");
    if (typeof email !== "string" || !email.includes("@")) return;
    setState("sending");
    try {
      const res = await fetch(FORMSPREE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email,
          campaign: "keystone-cit-cin-17615188",
          page: typeof window !== "undefined" ? window.location.href : "/keystone",
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="keystone-notify">
      <p className="eyebrow">Don&apos;t miss kickoff</p>
      {state === "done" ? (
        <p className="keystone-notify-success" role="status">
          ✓ You&apos;re on the list. One email before betting opens, one when the
          receipts land. Nothing else.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="keystone-notify-form">
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            aria-label="Email address"
            disabled={state === "sending"}
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Adding…" : "Notify me"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p className="keystone-notify-error" role="alert">
          That didn&apos;t go through. Try again, or{" "}
          <a href={keystoneCalendarHref()} download="stoppage-keystone.ics">
            grab the calendar file
          </a>{" "}
          instead.
        </p>
      )}
      <p className="keystone-notify-note">
        Devnet SOL only — this is the settlement primitive&apos;s first public
        match. Betting opens Saturday 21:30 UTC, kickoff 23:30 UTC.
      </p>
      <Link href="/markets" className="quiet-link">
        Or browse open markets now →
      </Link>
    </div>
  );
}
