"use client";

import Link from "next/link";
import { StoppageClock } from "@/components/StoppageClock";

export default function NotFound() {
  return (
    <main className="app-shell">
      <section className="not-found-shell">
        <div className="not-found-inner">
          <StoppageClock size={380} className="stoppage-clock-404" />
          <div className="not-found-content">
            <h1>45+4&apos;</h1>
            <p>Page not found — deep in stoppage time</p>
            <Link href="/">Back to kickoff →</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
