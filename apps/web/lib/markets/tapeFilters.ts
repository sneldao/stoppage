/**
 * Tape filter shape — single source of truth for the four-state /markets
 * filter. Both apps/web/app/markets/page.tsx (button row) and
 * apps/web/components/MarketsEmptyState.tsx (filter-aware empty state)
 * import from here. Component-specific copy lives in the empty-state
 * component; the filter shape is the only thing shared.
 */

export const tapeFilters = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "awaiting_settlement", label: "Settling" },
  { id: "settled", label: "Resolved" },
] as const;

export type TapeFilter = (typeof tapeFilters)[number]["id"];

/** Derived from the array — never edit directly. If you add a filter, add it
 *  to tapeFilters above and FILTER_LABEL picks it up automatically. */
export const FILTER_LABEL: Record<TapeFilter, string> = Object.fromEntries(
  tapeFilters.map((t) => [t.id, t.label])
) as Record<TapeFilter, string>;
