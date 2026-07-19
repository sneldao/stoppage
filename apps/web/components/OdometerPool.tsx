"use client";

/**
 * OdometerPool — digit-rolling pool counter.
 *
 * Renders a pool value (in SOL) where each digit independently rolls
 * upward when the value increases, mimicking a mechanical odometer.
 * Wires directly to `yesPool + noPool` from the market store.
 */

import { useEffect, useRef, useState } from "react";
import { LAMPORTS_PER_SOL } from "@/lib/format";

interface OdometerPoolProps {
  /** Pool total in lamports */
  lamports: number;
  /** Label shown above the counter (e.g. "Total pool") */
  label?: string;
  className?: string;
}

/** Format lamports to a fixed-width SOL string, e.g. "0.125" */
function toSolString(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(3);
}

/** Split a decimal string into individual character slots */
function toSlots(value: string): string[] {
  return value.split("");
}

interface DigitSlotProps {
  char: string;
  prev: string;
  rolling: boolean;
}

/**
 * A single character slot. If `rolling` is true and the char changed,
 * plays a brief CSS upward-roll animation.
 */
function DigitSlot({ char, prev, rolling }: DigitSlotProps) {
  const changed = rolling && char !== prev;
  const isDot = char === ".";

  if (isDot) {
    return <span className="odometer-dot">.</span>;
  }

  return (
    <span
      className={`odometer-digit ${changed ? "odometer-digit--rolling" : ""}`}
      key={`${char}-${prev}`}
    >
      {/* The exiting digit slides out upward */}
      {changed && <span className="odometer-digit-exit" aria-hidden="true">{prev}</span>}
      {/* The entering digit slides in from below */}
      <span className="odometer-digit-enter">{char}</span>
    </span>
  );
}

export function OdometerPool({ lamports, label, className = "" }: OdometerPoolProps) {
  const current = toSolString(lamports);
  const prevRef = useRef(current);
  const [displayValue, setDisplayValue] = useState(current);
  const [rollingValue, setRollingValue] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(current);

  useEffect(() => {
    if (current === prevRef.current) return;

    // Kick off the roll animation
    setPrevValue(prevRef.current);
    setRollingValue(current);

    const timer = window.setTimeout(() => {
      setDisplayValue(current);
      setRollingValue(null);
      setPrevValue(current);
    }, 400); // matches CSS animation duration

    prevRef.current = current;
    return () => window.clearTimeout(timer);
  }, [current]);

  const activeValue = rollingValue ?? displayValue;
  const currentSlots = toSlots(activeValue);
  const prevSlots = toSlots(prevValue);

  return (
    <div className={`odometer-pool ${className}`} aria-label={label ? `${label}: ${activeValue} SOL` : `${activeValue} SOL`}>
      {label && <span className="odometer-label">{label}</span>}
      <div className="odometer-digits" aria-live="polite" aria-atomic="true">
        {currentSlots.map((char, i) => (
          <DigitSlot
            key={i}
            char={char}
            prev={prevSlots[i] ?? char}
            rolling={rollingValue !== null}
          />
        ))}
        <span className="odometer-unit">SOL</span>
      </div>
    </div>
  );
}
