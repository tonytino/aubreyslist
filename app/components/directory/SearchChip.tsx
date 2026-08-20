import { Search, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Directory search rendered as a filter chip.
 *
 * The search shares the visual language of {@link FilterChips}: a pill that
 * reads as "just another filter". It has three states:
 *
 *   - **Collapsed + empty** — an inactive-style chip (a `<button>`), icon-only
 *     so a compact chip, not a wide "Search restaurants" pill, leads the row.
 *     The accessible name comes from `aria-label="Search restaurants"` and it
 *     carries `aria-expanded`, so screen readers get the information sighted
 *     users lose by dropping the text. Clicking/focusing it expands to a real
 *     input with the "Search restaurants" placeholder.
 *   - **Collapsed + applied** — when there's a query, the chip takes the
 *     active brand-filled treatment (colour signals "applied", but never alone
 *     — the query text and an explicit clear affordance carry the meaning too)
 *     and shows the (truncated) query with a small ✕ that clears it. This
 *     state stays text + icon (never icon-only) — an applied filter must
 *     remain visibly identifiable.
 *   - **Expanded** — a real, labelled `<input type="search">` wired to
 *     value/onChange, autofocused on expand, with its own inline ✕ while
 *     non-empty. Blurring the input collapses back to the chip (the query is
 *     kept, so a non-empty query returns as the applied chip).
 *
 * Controlled: `{ value, onChange }`. The route debounces `value` → URL `?q=`,
 * so there is no debounce here — every keystroke is reported straight to
 * `onChange`.
 *
 * Accessibility: the collapsed control is a `<button>` carrying
 * `aria-expanded`; expanding moves focus into a labelled input
 * (visually-hidden `<label>`). The native `::-webkit-search-cancel-button` is
 * suppressed so the ✕ is consistent.
 *
 * Focus timing (iOS): `expand()` flushes the `setExpanded(true)` state update
 * synchronously via `flushSync` before calling `.focus()`. iOS Safari only
 * auto-shows the keyboard when `.focus()` runs synchronously within the
 * original user-gesture call stack; any deferral (e.g.
 * `requestAnimationFrame`) breaks that chain and the keyboard needs a second
 * tap. `flushSync` commits + mounts the `<input>` immediately, so the ref is
 * live and `.focus()` still runs inside the same gesture.
 */
export function SearchChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const applied = value !== "";

  // Shared chip pill classes; mirrors FilterChips' `chipClasses` helper so the
  // search chip is visually indistinguishable from the taxonomy/quick chips.
  const chipBase =
    "inline-flex shrink-0 items-center gap-1.5 rounded-chip border px-3 py-2 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";
  const chipInactive = "border-border bg-surface text-foreground hover:bg-brand-soft";
  const chipActive = "border-brand bg-brand text-brand-foreground";

  function expand() {
    // Synchronous commit + focus, both still inside the click's user-gesture call
    // stack — see the focus-timing doc comment above. `flushSync` mounts the
    // `<input>` immediately so `inputRef.current` is live right after.
    flushSync(() => setExpanded(true));
    inputRef.current?.focus();
  }

  if (expanded) {
    return (
      <div className="relative shrink-0">
        <label htmlFor={inputId} className="sr-only">
          Search restaurants
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setExpanded(false)}
          placeholder="Search restaurants"
          className="w-64 max-w-full rounded-chip border-[1.5px] border-brand-ring bg-surface py-2 pl-9 pr-9 text-body-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring/40 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {applied ? (
          <button
            type="button"
            aria-label="Clear search"
            // Keep the input focused so a click on ✕ clears without collapsing.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 flex size-[22px] -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  if (applied) {
    // A chip-styled container holding two real buttons: the body reopens the
    // input; the trailing ✕ clears. A container (not a single <button>) avoids
    // nesting interactive elements, so both actions stay semantic buttons.
    return (
      <span className={`${chipBase} ${chipActive} pr-1.5`}>
        <button
          type="button"
          aria-expanded={false}
          aria-label={`Search: ${value}`}
          onClick={expand}
          className="-my-2 -ml-3 flex items-center gap-1.5 rounded-chip py-2 pl-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <Search className="size-4" strokeWidth={2.25} aria-hidden="true" />
          <span className="max-w-[10rem] truncate">{value}</span>
        </button>
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex size-5 items-center justify-center rounded-full hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </span>
    );
  }

  // Collapsed + empty: icon-only — the accessible name lives entirely in
  // `aria-label`, so screen readers still announce "Search restaurants" even
  // though sighted users only see the glyph.
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label="Search restaurants"
      onClick={expand}
      className={`${chipBase} ${chipInactive}`}
    >
      <Search className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
