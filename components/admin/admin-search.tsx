"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { matchesFacets, matchesQuery, normalizeQuery, rowFacetsFromDataset, searchTerms, type ListFacet } from "@/lib/search";

type Counts = { visible: number; total: number };

/**
 * Search and filter toolbar for the admin list screens.
 *
 * Filtering runs entirely in the browser over rows the server already sent, so a
 * keystroke never triggers a server render. The previous version wrote to
 * `?q=` through `router.replace`, which re-fetched the whole route — layout
 * session check, notification feed, and every list query — on every character,
 * and the results only appeared once that round trip and the re-render of the
 * entire page finished. Reading and hiding the rows that are already on screen
 * is a few microseconds.
 *
 * `?q=` and the facet values are still mirrored into the URL, but with
 * `history.replaceState`, so a filtered list stays shareable and survives a
 * refresh without costing a navigation. On a cold load the server filters from
 * the same parameters as before, so a shared link arrives already filtered
 * rather than showing every row first.
 *
 * The text query and the facets live in this one component on purpose: both hide
 * rows, and two components hiding rows independently is how they end up
 * disagreeing about what a row is — one showing it because the text matched,
 * the other hiding it because the category did not.
 *
 * Rows opt in by carrying `data-row-text` and one `data-row-<key>` per facet
 * group: the same strings the server would have matched against, so the two can
 * never disagree about what matches.
 */
export function AdminSearch({
  placeholder,
  label = "Search",
  facets = [],
}: {
  placeholder: string;
  label?: string;
  /** Filter dimensions. Omitted on the screens that only need a text search. */
  facets?: readonly ListFacet[];
}) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => normalizeQuery(searchParams.get("q") ?? ""));
  const sectionRef = useRef<HTMLElement>(null);
  const fieldId = `admin-search-${label.replace(/\s+/g, "-").toLowerCase()}`;

  /*
   * Read once, through a lazy initialiser: `useSearchParams` is a live object,
   * and deriving the state from it in the render body would be re-derived on
   * every parent render without the answer ever changing.
   */
  const [active, setActive] = useState<Record<string, string>>(() => Object.fromEntries(facets.map((group) => [group.key, normalizeQuery(searchParams.get(group.key) ?? "")])));

  /*
   * The row counts are read back out of the DOM, so React cannot derive them
   * during its own render — the rows it would be counting are the ones the
   * filter just wrote to. That makes the count a genuine external store, and
   * `useSyncExternalStore` is what React provides for rendering from one.
   *
   * The snapshot object is replaced only when a count actually changes. That
   * identity check is what stops the mutation observer below from looping: its
   * own re-render changes the toolbar's text, which is a mutation inside the
   * subtree it watches.
   */
  const countsRef = useRef<Counts>({ visible: 0, total: 0 });
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((onStoreChange: () => void) => {
    listenersRef.current.add(onStoreChange);
    return () => {
      listenersRef.current.delete(onStoreChange);
    };
  }, []);

  const counts = useSyncExternalStore(subscribe, () => countsRef.current, () => countsRef.current);

  const apply = useCallback(
    (next: string, nextActive: Record<string, string>) => {
      const scope = sectionRef.current?.closest("main") ?? document.body;
      const terms = searchTerms(next);
      const rows = scope.querySelectorAll<HTMLElement>("[data-row-text]");
      // Read through the shared helper rather than a mapping written here: the
      // attribute is stored camel-cased and has to come back keyed by the facet
      // the selection is written in, and getting that backwards hides every row
      // the moment a filter is chosen.
      const keys = Object.keys(nextActive);
      let visible = 0;
      for (const row of rows) {
        const facets = rowFacetsFromDataset(row.dataset, keys);
        const show = matchesQuery(row.dataset.rowText ?? "", terms) && matchesFacets(facets, nextActive);
        // An inline style, not the `hidden` attribute: these rows carry Tailwind
        // `flex`/`grid` utilities, which land after the preflight `[hidden]` rule
        // in the cascade and would win, leaving "hidden" rows on screen.
        row.style.display = show ? "" : "none";
        if (show) visible += 1;
      }
      const total = rows.length;
      const current = countsRef.current;
      if (current.visible === visible && current.total === total) return;
      countsRef.current = { visible, total };
      for (const listener of listenersRef.current) listener();
    },
    [],
  );

  // Runs on mount and on every keystroke. Deliberately not debounced: the work
  // is a loop over the rows already in the DOM, so delaying it would only add
  // latency. This effect only writes to the DOM — the external system — and
  // publishes a new snapshot only when the numbers really moved.
  useEffect(() => {
    apply(query, active);
  }, [active, apply, query]);

  // A form action repaints the list from the database without changing the
  // query, so the rows are replaced behind the toolbar's back. Re-apply on any
  // child change or the filter silently stops matching anything.
  useEffect(() => {
    const scope = sectionRef.current?.closest("main") ?? document.body;
    const observer = new MutationObserver(() => apply(query, active));
    observer.observe(scope, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, apply, query]);

  /**
   * Writes the query and the facets into the URL together.
   *
   * The parameters are read back out of `window.location` at write time rather
   * than from a captured copy, so the text query and a facet cannot overwrite
   * each other when both change.
   */
  function commit(next: string, nextActive: Record<string, string>) {
    const params = new URLSearchParams(window.location.search);
    const trimmed = next.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    for (const group of facets) {
      const value = nextActive[group.key] ?? "";
      if (value) params.set(group.key, value);
      else params.delete(group.key);
    }
    const search = params.toString();
    // `replaceState`, not the router: the list is already correct, so a
    // navigation here would re-render the page purely to confirm what the
    // browser already knows.
    window.history.replaceState(null, "", search ? `${window.location.pathname}?${search}` : window.location.pathname);
    setQuery(trimmed);
    setActive(nextActive);
  }

  const activeCount = facets.filter((group) => active[group.key]).length;
  const hasQuery = query.length > 0;
  const filtered = hasQuery || activeCount > 0;
  const noMatches = filtered && counts.total > 0 && counts.visible === 0;

  return (
    <section ref={sectionRef} className="rounded-[24px] border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm">
      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          commit(query, active);
        }}
      >
        <div className="relative min-w-0 flex-1">
          <label htmlFor={fieldId} className="sr-only">
            {label}
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
          <Input
            id={fieldId}
            value={query}
            onChange={(event) => commit(event.target.value, active)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                commit("", active);
              }
            }}
            placeholder={placeholder}
            type="search"
            autoComplete="off"
            className="pl-11"
          />
        </div>

        <div className="flex items-center gap-3">
          <p className="whitespace-nowrap text-sm text-[var(--muted)]" aria-live="polite">
            {filtered ? `${counts.visible} of ${counts.total}` : `${counts.total} total`}
          </p>
          {filtered ? (
            <Button type="button" size="sm" variant="outline" onClick={() => commit("", {})}>
              <X className="mr-2 h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      {/*
        Outside the form on purpose: these set the URL, they do not submit
        anything, and a `<select>` inside a form is one Enter away from reloading
        the route the filters are meant to avoid reloading.
      */}
      {facets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
            Filter
          </span>
          {facets.map((group) => (
            <FacetControl key={group.key} group={group} value={active[group.key] ?? ""} onChange={(value) => commit(query, { ...active, [group.key]: value })} />
          ))}
          {activeCount > 0 ? (
            // Distinct from "Clear": this drops the filters and keeps what was
            // typed, which is the case where all of them are wrong together.
            <button type="button" onClick={() => commit(query, Object.fromEntries(facets.map((group) => [group.key, ""])))} className="text-xs font-medium text-[var(--brand)] underline underline-offset-2">
              Reset filters
            </button>
          ) : null}
        </div>
      ) : null}

      {noMatches ? (
        <p role="alert" className="mt-3 rounded-2xl bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-text)]">
          Nothing matches
          {hasQuery ? ` “${query}”` : ""}
          {activeCount > 0 ? ` with ${describeFacets(facets, active)}` : ""}. Check the spelling, or clear the filters to see everything.
        </p>
      ) : null}
    </section>
  );
}

/** One facet as a native select: short lists, and "All" as the first option. */
function FacetControl({ group, value, onChange }: { group: ListFacet; value: string; onChange: (value: string) => void }) {
  const id = `facet-${group.key}`;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="whitespace-nowrap text-xs font-medium text-[var(--muted)]">
        {group.label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 max-w-[220px] rounded-xl border border-[var(--line)] bg-[var(--input)] px-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]"
      >
        {/* "All" rather than an empty control: a blank select reads as broken
            rather than as "no filter", and this is the way back out of one. */}
        <option value="">All {group.label.toLowerCase()}</option>
        {group.values.map((option) => (
          <option key={option} value={option}>
            {group.labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Category: Chair and Stock: Out of stock", for the no-matches message. */
function describeFacets(facets: readonly ListFacet[], active: Record<string, string>) {
  const parts = facets.filter((group) => active[group.key]).map((group) => `${group.label.toLowerCase()}: ${(group.labels?.[active[group.key]] ?? active[group.key]).toLowerCase()}`);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
