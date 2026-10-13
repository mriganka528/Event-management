/**
 * Theme scoping.
 *
 * A single global `localStorage.theme` key meant one preference applied to the
 * whole application: a customer who picked dark mode on the marketing site, and
 * then opened their dashboard, got the staff workspace's theme too — and a
 * super admin who prefers dark on the admin panel could not keep the customer
 * site light without flipping the panel as well.
 *
 * So a theme is now stored per area. Each area falls back to the operating
 * system preference on first visit, and areas do not read each other's value.
 * Deliberately free of `"use client"`, `server-only`, and any browser API at
 * module scope: the root layout imports it to build the pre-paint bootstrap
 * script, and client components import it to read and write the value, so the
 * area rules have to be the same definition in both places.
 */

export type Theme = "light" | "dark";

/** Preference is stored per-area; `site` is the public marketing surface. */
export type ThemeArea = "site" | "admin" | "staff" | "customer";

/**
 * Longest-prefix-wins is done by ordering, not by length: `/admin` and
 * `/staff` cannot nest, so an explicit table is clearer than string sorting.
 */
const AREA_PREFIXES: ReadonlyArray<readonly [ThemeArea, string]> = [
  ["admin", "/admin"],
  ["staff", "/staff"],
  ["customer", "/customer"],
];

export function themeAreaForPath(pathname: string): ThemeArea {
  for (const [area, prefix] of AREA_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return area;
  }
  // Everything else — the landing page, packages, services, contact, and the
  // staff-facing auth screens — shares the public theme. `/customer/auth/*` is
  // under `/customer`, so customer authentication uses the customer area.
  return "site";
}

export function themeStorageKey(area: ThemeArea): string {
  return `theme:${area}`;
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Pre-paint bootstrap, inlined into the document head.
 *
 * This has to run before the first paint or a dark-mode admin opening a light
 * marketing page would see a white flash. It is emitted as a string because it
 * is a `<script>` in the document, so it cannot import anything — the area rules
 * are therefore duplicated here deliberately, and
 * `tests/theme-scope.test.ts` asserts the two copies agree.
 *
 * Escaping is not a concern for the fixed literals below; nothing
 * request-controlled reaches this string.
 */
export function themeBootstrapScript(): string {
  return `(() => {
  try {
    var p = location.pathname;
    var area = (p === "/admin" || p.indexOf("/admin/") === 0) ? "admin"
      : (p === "/staff" || p.indexOf("/staff/") === 0) ? "staff"
      : (p === "/customer" || p.indexOf("/customer/") === 0) ? "customer"
      : "site";
    var key = "theme:" + area;
    var saved = localStorage.getItem(key);
    // One-time carry-over from the single global key this replaced, so nobody
    // silently loses the preference they had already set.
    if (saved === null) {
      var legacy = localStorage.getItem("theme");
      if (legacy === "dark" || legacy === "light") {
        saved = legacy;
        localStorage.setItem(key, legacy);
      }
    }
    var theme = (saved === "dark" || saved === "light") ? saved
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
})()`;
}