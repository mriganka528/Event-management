/**
 * Sidebar highlighting rules, kept out of the component so they can be tested
 * and so every workspace agrees on what "the current page" means.
 *
 * The previous version lived inline in `admin-sidebar.tsx` and de-duplicated
 * against every entry in the list. Because `/admin` is itself an entry and
 * every admin route starts with `/admin/`, that comparison always found a
 * "more specific" match and returned false — so only the dashboard ever lit up
 * and every other link stayed grey, on click and on redirect alike.
 */

import { matchesQuery, rowText, searchTerms } from "@/lib/search";

export type NavEntry = { href: string };

/** An entry the sidebar search can match: a label, and words it should answer to. */
export type SearchableNavEntry = NavEntry & {
  label: string;
  /**
   * Words that lead here but are not in the label. Somebody who thinks of the
   * inventory screen as "stock", or of payments as "money", should not have to
   * guess the word the sidebar happens to use.
   */
  keywords?: readonly string[];
};

/** Trailing slashes, an index segment, and query strings must not change the match. */
export function normalizePath(value: string) {
  const trimmed = value.split(/[?#]/)[0].replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

/**
 * True when `href` owns `pathname`, either exactly or as a parent segment.
 *
 * The exact case matters as much as the prefix case. A previous version only
 * tested `path.startsWith(child + "/")`, which is never true for the child
 * itself — so `/admin/settings/credentials` lit up "Settings" as well, and
 * `/admin/events` left "Dashboard" lit because no *deeper* entry appeared to own
 * the path. Two links highlighted at once, on every nested admin route.
 */
function owns(path: string, target: string) {
  return path === target || path.startsWith(`${target}/`);
}

/**
 * True when `href` is the entry that owns `pathname`.
 *
 * Exact matches always win. A prefix match loses only to a *longer* entry that
 * also owns the path, which is what keeps `/admin/settings/credentials` from
 * lighting up `/admin/settings` as well.
 */
export function isActiveRoute(pathname: string, href: string, entries: readonly NavEntry[] = []) {
  const path = normalizePath(pathname);
  const target = normalizePath(href);

  if (path === target) return true;
  if (!path.startsWith(`${target}/`)) return false;

  return !entries.some((entry) => {
    const other = normalizePath(entry.href);
    return other.length > target.length && owns(path, other);
  });
}

/** Every entry that would be highlighted for `pathname`. Must never exceed one. */
export function activeRoutes(pathname: string, entries: readonly NavEntry[]): string[] {
  return entries.filter((entry) => isActiveRoute(pathname, entry.href, entries)).map((entry) => entry.href);
}

/** The label of the entry that owns `pathname`, or `null` when none does. */
export function activeNavLabel(pathname: string, entries: readonly NavEntry[]) {
  const match = entries.find((entry) => isActiveRoute(pathname, entry.href, entries)) as (NavEntry & { label?: string }) | undefined;
  return match?.label ?? null;
}

/**
 * The entries a sidebar search should show, in their original order.
 *
 * Matches the label and the entry's keywords, and deliberately not the href:
 * every admin entry begins `/admin`, so a search for "admin" would return the
 * whole list — indistinguishable from a search that did nothing.
 *
 * It uses the same term rule as the admin list screens, so "staff booking" and
 * "invent" narrow the sidebar exactly the way they narrow the tables below it.
 */
export function filterNavigation<T extends SearchableNavEntry>(query: string, entries: readonly T[]): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...entries];
  return entries.filter((entry) => matchesQuery(rowText(entry.label, ...(entry.keywords ?? [])), terms));
}

