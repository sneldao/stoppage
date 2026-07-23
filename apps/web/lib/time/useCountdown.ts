import { useEffect, useState } from "react";

export function safeStartTime(fixture: { StartTime: unknown }): Date {
  const raw = fixture.StartTime;
  if (typeof raw === "number") return new Date(raw < 1_000_000_000_000 ? raw * 1000 : raw);
  if (typeof raw === "string") return new Date(raw);
  return new Date(0);
}

export function useCountdown(target: Date | null): string {
  const [label, setLabel] = useState("");
  const targetTime = target?.getTime() ?? null;

  useEffect(() => {
    if (targetTime == null) return;
    const targetDate = new Date(targetTime);

    const tick = () => {
      const diff = targetDate.getTime() - Date.now();
      if (diff <= 0) {
        setLabel("Now");
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      const days = Math.floor(h / 24);
      setLabel(days > 0 ? `${days}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };

    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [targetTime]);

  return label;
}
