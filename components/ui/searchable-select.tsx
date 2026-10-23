"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Option = {
  label: string;
  value: string;
};

/** A row in the list, which may be an option or one the operator just typed. */
type ListRow = Option & { custom?: boolean };

/**
 * The styles both pickers share, exported so a second combobox cannot drift into
 * a different height, corner radius, or focus ring from the first.
 */
export const COMBOBOX_CLASS = {
  trigger:
    "flex h-11 w-full min-w-0 items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--input)] px-4 text-left text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-60",
  open: "border-[var(--brand)] ring-2 ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]",
  panel: "absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-lg",
  filterRow: "flex items-center gap-2 border-b border-[var(--line)] px-3",
  filter: "h-10 w-full min-w-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]",
  list: "max-h-64 overflow-y-auto p-1",
  row: "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
  rowActive: "bg-[var(--surface-muted)]",
  rowHover: "hover:bg-[var(--surface-muted)]",
} as const;

/**
 * The rows a query matches, plus the typed value itself when the field accepts
 * one that is not on the list.
 *
 * Substring rather than prefix, because that is what makes a long list usable:
 * "tab" has to reach "Tablecloth" as readily as "Table". The typed value goes
 * last so Enter still takes the closest match — typing "se" should offer
 * "session", not a service literally called "se".
 */
export function filterOptions(options: readonly Option[], query: string, allowCustomValue = false): ListRow[] {
  const needle = query.trim();
  const lower = needle.toLowerCase();
  const filtered = lower ? options.filter((option) => option.label.toLowerCase().includes(lower)) : options;
  const rows: ListRow[] = filtered.map((option) => ({ label: option.label, value: option.value }));
  if (allowCustomValue && needle && !filtered.some((option) => option.label.toLowerCase() === lower)) {
    rows.push({ label: needle, value: needle, custom: true });
  }
  return rows;
}

/**
 * A `<select>` you can type into.
 *
 * The native control is fine for four options and unusable for eighteen. The
 * inventory category list crossed that line when cloth, power, and temperature
 * were given categories of their own: an admin who wanted the extension cable
 * had to open a dropdown and scroll, with nothing to search, and on a phone the
 * native list is a full-screen picker over the top of the form.
 *
 * Three things it has to keep doing that a `<select>` did:
 *
 *  - submit the chosen value under `name`, so the server action reads it
 *    unchanged. That is the hidden input; everything visible is a button and a
 *    filter field.
 *  - leave a stored value alone until the operator picks something else, so
 *    opening the editor and saving cannot quietly rewrite the record. A control
 *    with no `defaultValue` would paint its first option and do exactly that.
 *  - tell the caller what happened through `onValueChange`. A button click fires
 *    neither `change` nor `input`, so the admin dialogs — which keep Save
 *    disabled until a field has really been touched — are notified here rather
 *    than by listening on the form.
 */
export function SearchableSelect({
  name,
  options,
  value,
  defaultValue = "",
  placeholder = "Search…",
  emptyLabel = "Nothing selected",
  clearable = false,
  allowCustomValue = false,
  disabled = false,
  required = false,
  onValueChange,
  className,
}: {
  name: string;
  options: readonly Option[];
  /** Controlled value. Leave unset for a control that manages its own. */
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  emptyLabel?: string;
  /** Adds a button that returns the field to an empty value. */
  clearable?: boolean;
  /**
   * Lets the operator keep a value that is not in `options`.
   *
   * A closed list is only honest when the list is complete. A unit label is not:
   * "per batch" or "per square foot" is a real answer for some services, and a
   * control that silently refuses them forces the admin back to a free-text box —
   * which is where the suggestions went in the first place.
   */
  allowCustomValue?: boolean;
  disabled?: boolean;
  required?: boolean;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  const listId = useId();
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const [committed, setCommitted] = useState(selected);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const matches = useMemo(() => filterOptions(options, query, allowCustomValue), [allowCustomValue, options, query]);

  const selectedLabel = useMemo(() => {
    const match = options.find((option) => option.value === selected);
    // A value typed by hand is shown as it stands; only a genuinely empty field
    // falls back to the placeholder label.
    return match?.label ?? selected;
  }, [options, selected]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }, []);

  /**
   * Closes the list and hands focus back to the trigger. The filter field is
   * unmounted with the list, so without this a keyboard user is dropped at the
   * top of the document after every choice.
   */
  const dismiss = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  const choose = useCallback(
    (next: string) => {
      setInternal(next);
      setCommitted(next);
      onValueChange?.(next);
      dismiss();
    },
    [dismiss, onValueChange],
  );

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  // A pointer press anywhere else dismisses the list, as a native control does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [close, open]);

  // The query narrows the list, so a highlighted row can fall off the end of it.
  // Clamping while rendering keeps it in range without an effect that writes
  // state back into the component that just changed it.
  const highlighted = Math.min(highlight, Math.max(0, matches.length - 1));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (Math.min(current, matches.length - 1) + step + matches.length) % matches.length);
      return;
    }
    if (event.key === "Enter") {
      // The filter owns Enter while the list is open: it has to pick the
      // highlighted row instead of submitting the form the control sits in.
      if (!open || !matches.length) return;
      event.preventDefault();
      choose(matches[highlighted]?.value ?? matches[0].value);
      return;
    }
    if (event.key === "Tab") close();
  };

  const toggleList = () => {
    if (disabled) return;
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setQuery("");
    setHighlight(Math.max(0, matches.findIndex((option) => option.value === selected)));
  };

  const activeOption = matches[highlighted];

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      {/* The value the server action receives, unchanged. */}
      <input type="hidden" name={name} value={committed} data-searchable-select={name} />

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={toggleList}
        className={cn(COMBOBOX_CLASS.trigger, open && COMBOBOX_CLASS.open)}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selectedLabel && "text-[var(--muted)]")}>
          {selectedLabel || emptyLabel}
        </span>
        {clearable && selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(event) => {
              event.stopPropagation();
              choose("");
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--muted)] transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div className={COMBOBOX_CLASS.panel}>
          <div className={COMBOBOX_CLASS.filterRow}>
            <Search className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <input
              ref={filterRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? `${listId}-${highlighted}` : undefined}
              aria-required={required || undefined}
              aria-label={placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              placeholder={placeholder}
              className={COMBOBOX_CLASS.filter}
            />
          </div>
          <div id={listId} role="listbox" className={COMBOBOX_CLASS.list}>
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[var(--muted)]">No match for “{query.trim()}”.</p>
            ) : (
              matches.map((option, index) => {
                const active = option.value === selected && !option.custom;
                return (
                  <button
                    key={`${option.value}-${index}`}
                    type="button"
                    role="option"
                    id={`${listId}-${index}`}
                    aria-selected={active}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(option.value)}
                    className={cn(COMBOBOX_CLASS.row, index === highlighted ? COMBOBOX_CLASS.rowActive : COMBOBOX_CLASS.rowHover, option.custom && "border-t border-[var(--line)] text-[var(--brand-dark)]")}
                  >
                    {option.custom ? (
                      <>
                        <Plus className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Use “{option.label}”</span>
                      </>
                    ) : (
                      <>
                        <Check className={cn("h-4 w-4 shrink-0 text-[var(--brand)]", active ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      </>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
