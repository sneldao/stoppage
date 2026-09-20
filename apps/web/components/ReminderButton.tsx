"use client";

import { useCallback, useState } from "react";
import { loadReminders, toggleReminder } from "@/lib/reminders";

/**
 * ReminderButton — "tell me when betting opens" for one fixture.
 * Permission for Browser Notifications is requested on opt-in; the
 * in-app banner works regardless.
 */
export function ReminderButton({ matchId }: { matchId: string }) {
  const [on, setOn] = useState(() => loadReminders().includes(matchId));

  const toggle = useCallback(() => {
    const next = toggleReminder(matchId);
    setOn(next.includes(matchId));
    if (next.includes(matchId) && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    }
  }, [matchId]);

  return (
    <button
      type="button"
      className={`slate-remind ${on ? "slate-remind--on" : ""}`}
      aria-pressed={on}
      onClick={(e) => { e.preventDefault(); toggle(); }}
      title={on ? "Reminder on — betting opening will find you" : "Remind me when betting opens"}
    >
      {on ? "Reminder on" : "Remind me"}
    </button>
  );
}
