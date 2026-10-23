"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { COMBOBOX_CLASS, filterOptions } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";

type Option = { label: string; value: string };

/**
 * The same picker as `SearchableSelect`, for a field that holds more than one
 * value.
 *
 * A service can draw on several stock categories at once — a table-and-chair
 * arrangement needs both, and a buffet station needs crockery *and* a counter —
 * so the field has to take a list. It shares the filter, the keyboard handling,
 * and the styles with the single-value picker rather than growing a `multiple`
 * branch through it, because the two have genuinely different behaviour: one
 * choice closes the list, several keep it open.
 *
 * The selected values are submitted as one hidden field per value under the same
 * name, which is what `FormData.getAll` reads on the server.
 */
export function MultiSearchableSelect({
  name,
  options,
  values,
  defaultValues = [],
  placeholder = "Search…",
  emptyLabel = "Nothing selected",
  disabled = false,
  onValuesChange,
  className,
}: {
  name: string;
  options: readonly Option[];
  /** Controlled list. Leave unset for a field that manages its own. */
  values?: readonly string[];
  defaultValues?: readonly string[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Called with the whole new list, so a dialog can count this as a real edit. */
  onValuesChange?: (values: string[]) => void;
  className?: string;
}) {
  const listId = useId();
  const [internal, setInternal] = useState<string[]>([...defaultValues]);
  const selected = values ?? internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => filterOptions(options, query), [options, query]);
  // Clamped while rendering: the query narrows the list, so the highlighted row
  // can fall off the end of it.
  const highlighted = Math.min(highlight, Math.max(0, rows.length - 1));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }, []);

  const labelOf = useCallback((value: string) => options.find((option) => option.value === value)?.label ?? value, [options]);

  const toggle = useCallback(
    (value: string) => {
      const next = selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value];
      setInternal(next);
      onValuesChange?.(next);
      // The list stays open: picking the second of two categories should not
      // require reopening the picker.
    },
    [onValuesChange, selected],
  );

  const remove = useCallback(
    (value: string) => {
      const next = selected.filter((entry) => entry !== value);
      setInternal(next);
      onValuesChange?.(next);
    },
    [onValuesChange, selected],
  );

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [close, open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (Math.min(current, rows.length - 1) + step + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter") {
      // Toggles rather than submits: Enter picks the highlighted row, it does not
      // send the form the control sits in.
      if (!open || !rows.length) return;
      event.preventDefault();
      toggle(rows[highlighted]?.value ?? rows[0].value);
      setHighlight(0);
      return;
    }
    if (event.key === "Tab") close();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      {/* One hidden field per value, all under the same name: `getAll` reads
          them all, which is what the multi-select has to submit. */}
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(COMBOBOX_CLASS.trigger, open && COMBOBOX_CLASS.open, "flex-wrap")}
      >
        {selected.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{emptyLabel}</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selected.map((value) => (
              <span key={value} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-medium">
                {labelOf(value)}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${labelOf(value)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(value);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))}
          </span>
        )}
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
              aria-activedescendant={rows[highlighted] ? `${listId}-${highlighted}` : undefined}
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
          <div id={listId} role="listbox" aria-multiselectable="true" className={COMBOBOX_CLASS.list}>
            {rows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[var(--muted)]">No match for “{query.trim()}”.</p>
            ) : (
              rows.map((option, index) => {
                const checked = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    id={`${listId}-${index}`}
                    aria-selected={checked}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => toggle(option.value)}
                    className={cn(COMBOBOX_CLASS.row, index === highlighted ? COMBOBOX_CLASS.rowActive : COMBOBOX_CLASS.rowHover)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line-strong)]",
                      )}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
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
