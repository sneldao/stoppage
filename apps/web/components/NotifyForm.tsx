"use client";

import { useState } from "react";
import Link from "next/link";
import { keystoneCalendarHref } from "@/lib/campaign/keystone";

/**
 * Formspree endpoint for the keystone "notify me" lead capture
 * (https://formspree.io/f/mppalqoo — AJAX pattern: JSON POST with
 * Accept: application/json). Override via NEXT_PUBLIC_FORMSPREE_ID only
 * when pointing a future campaign at a different form. Setting the
 * placeholder value falls back to the calendar-link CTA.
 */
const FORMSPREE_ID = process.env.NEXT_PUBLIC_FORMSPREE_ID ?? "mppalqoo";

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
  const [fieldError, setFieldError] = useState<string | null>(null);

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
    setFieldError(null);
    const data = new FormData(e.currentTarget);
    const email = data.get("email");
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
          _subject: "Stoppage keystone notify — Orlando City v FC Cincinnati",
          // Formspree honeypot — non-empty means a bot filled it; dropped.
          _gotcha: typeof data.get("_gotcha") === "string" ? data.get("_gotcha") : "",
        }),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      // Formspree returns { errors: { email: [{ message }] } } on field-level
      // failures (invalid address, rate limit) — surface them inline.
      const body = await res.json().catch(() => null);
      const emailErrors = (body as { errors?: { email?: { message: string }[] } } | null)
        ?.errors?.email;
      setFieldError(emailErrors?.[0]?.message ?? null);
      setState("error");
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
          {/* Formspree honeypot — bots fill it, submissions are silently
              dropped. Visually hidden, never shown to humans. */}
          <input
            type="text"
            name="_gotcha"
            tabIndex={-1}
            autoComplete="off"
            className="keystone-gotcha"
            aria-hidden="true"
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Adding…" : "Notify me"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p className="keystone-notify-error" role="alert">
          {fieldError
            ? `Formspree: ${fieldError}`
            : "That didn't go through."}{" "}
          Try again, or{" "}
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
