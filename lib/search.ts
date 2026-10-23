/**
 * Query-string search shared by every admin list screen.
 *
 * The same rule runs in two places and must agree: the server, which hides the
 * rows that do not match before the first paint, and the browser, which does it
 * on every keystroke. Keeping both on these two functions is what guarantees a
 * shared `?q=` link and a typed search return the same rows.
 *
 * A plain module, so neither side pulls Prisma into the client bundle.
 */

/** `?q=` values arrive as `string | string[] | undefined`. */
export function normalizeQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  // Bounded because the value is echoed back into the query string and into the
  // "no matches for …" message.
  return raw.trim().slice(0, 120);
}

/**
 * Splits into terms so "white chair" matches "White banquet chairs", which a
 * single substring test would miss. Every term must appear somewhere.
 */
export function searchTerms(query: string) {
  return normalizeQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery(haystack: string, terms: readonly string[]) {
  if (terms.length === 0) return true;
  const text = haystack.toLowerCase();
  return terms.every((term) => text.includes(term));
}

/**
 * Builds the searchable text for one row.
 *
 * The same string is used to pre-hide rows on the server and is written to
 * `data-row-text` for the browser, so the two can never disagree about what
 * matches. Lower-cased once here rather than on every keystroke.
 */
export function rowText(...parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

/**
 * Builds the per-row visibility function for a server render.
 *
 * Rows are never left out of the HTML. A non-matching row is rendered with
 * `display: none`, which means the first paint of a shared `?q=` link is already
 * narrowed — no flash of the full list — while every row stays in the DOM for
 * the browser to reveal again the moment the search is cleared, with no request.
 *
 * Inline `style` rather than the `hidden` attribute: these rows carry Tailwind
 * `flex`/`grid` utilities that are emitted after the preflight `[hidden]` rule
 * and would otherwise win, leaving a "hidden" row visible.
 */
export function rowFilter(query: string) {
  const terms = searchTerms(query);
  return (text: string): { display: string } | undefined =>
    terms.length === 0 || matchesQuery(text, terms) ? undefined : { display: "none" };
}

/**
 * One filterable dimension of a list screen.
 *
 * The `key` is both the query-string parameter and the row attribute it is read
 * from (`category` → `?category=` and `data-row-category`), so a dimension can
 * never be wired up under one name on the server and another in the browser.
 */
export type ListFacet = {
  key: string;
  /** Label for the control, and for its accessible name. */
  label: string;
  /** Every value the dimension can take. Anything else in the URL is ignored. */
  values: readonly string[];
  /** Option text, where the stored value is not what a person would read. */
  labels?: Readonly<Record<string, string>>;
};

/**
 * The active selection for each dimension, read from the query string.
 *
 * Every value is checked against the group that declares it, so a hand-edited or
 * stale link cannot smuggle an unknown category past the server's own filter and
 * leave the screen showing "0 of 40" for a value no row has.
 */
export function listFacetsFromQuery(
  params: Record<string, string | string[] | undefined>,
  groups: readonly ListFacet[],
): Record<string, string> {
  const active: Record<string, string> = {};
  for (const group of groups) {
    const raw = params[group.key];
    const single = Array.isArray(raw) ? raw[0] : raw;
    const value = typeof single === "string" ? single.trim() : "";
    active[group.key] = group.values.includes(value) ? value : "";
  }
  return active;
}

/** The values one row has for one dimension, as both sides read them back. */
export function facetValue(...values: Array<string | number | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

/**
 * Whether a row's facets satisfy the active selection.
 *
 * A row belongs to a dimension when the value is one of the row's, so a service
 * linked to both tables and chairs is found by either. Runs in the browser on
 * every keystroke and on the server before the first paint, which is why it takes
 * a plain record rather than a DOM node or a Prisma row.
 */
export function matchesFacets(facets: Record<string, string>, active: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(active)) {
    if (!value) continue;
    const owned = (facets[key] ?? "").split(" ");
    if (!owned.includes(value)) return false;
  }
  return true;
}

/** The row attributes the browser reads a row's facets back out of. */
export function rowFacetAttributes(facets: Record<string, string>) {
  return Object.fromEntries(Object.entries(facets).map(([key, value]) => [`data-row-${key}`, value]));
}

/**
 * The `dataset` key an attribute is read back under: `data-row-category` is
 * `rowCategory`.
 *
 * Lives here rather than in the toolbar because this is where the two ends meet.
 * The server writes the attribute from a facet key and the browser reads it back
 * through this mapping, and the two only agree because both go through
 * `rowFacetAttributes` and this function.
 */
export function rowFacetDatasetKey(key: string) {
  return `row${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Reads one row's facets out of its attributes, keyed by facet again.
 *
 * The attribute is stored camel-cased and has to come back keyed by the facet the
 * selection is written in. Getting that backwards looks like the filter ignoring
 * itself: every row is read as owning nothing, so a chosen value matches none of
 * them and the whole list disappears.
 */
export function rowFacetsFromDataset(dataset: DOMStringMap | Record<string, string | undefined>, keys: readonly string[]): Record<string, string> {
  const facets: Record<string, string> = {};
  for (const key of keys) facets[key] = dataset[rowFacetDatasetKey(key)] ?? "";
  return facets;
}

/**
 * Builds the per-row visibility function for a server render, with the text query
 * and the facet selection applied together.
 *
 * The same pair of rules the browser applies on every keystroke, so a shared
 * `?q=chair&category=CHAIR` link arrives showing exactly the rows the live
 * filters would have shown.
 */
export function rowFilterWithFacets(query: string, active: Record<string, string>) {
  const terms = searchTerms(query);
  return (text: string, facets: Record<string, string> = {}): { display: string } | undefined =>
    (terms.length === 0 || matchesQuery(text, terms)) && matchesFacets(facets, active) ? undefined : { display: "none" };
}

