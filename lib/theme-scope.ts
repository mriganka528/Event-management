/**
 * Theme scoping.
 *
 * The application has exactly two themes, and a person gets to choose each one
 * without disturbing the other:
 *
 *  - **`customer`** — the public marketing pages *and* the customer-facing
 *    surfaces that sit behind them: the sign-in and account panels, the booking
 *    form, the dashboard. These used to be two separate areas, which is why a
 *    customer who chose dark on the home page met a light booking form. One area
 *    now covers the whole customer journey.
 *  - **`admin`** — the admin panel and the staff workspace. Both are the same
 *    business running its own screens, so they share one setting; a customer and
 *    an admin sharing a laptop each keep their own.
 *
 * The default is **light**, for everyone, always. The previous behaviour resolved
 * an unset preference from `prefers-color-scheme`, which meant a visitor on a
 * dark-mode device got dark and had no way to describe that as the bug.
 *
 * Deliberately free of `"use client"`, `server-only`, and any browser API at
 * module scope: the root layout imports it to build the pre-paint bootstrap
 * script, and client components import it to read and write the value, so the
 * rules have to be one definition usable from both.
 */

export type Theme = "light" | "dark";

export type ThemeArea = "customer" | "admin";

/**
 * What a person gets before they have chosen anything.
 *
 * Light, and not the operating system: an unset preference that silently follows
 * the OS is indistinguishable from the toggle not working, which is the complaint
 * this replaces.
 */
export const DEFAULT_THEME: Theme = "light";

/**
 * The area every route belongs to unless a prefix below claims it.
 *
 * Named explicitly because the fallback *is* the interesting case: the marketing
 * pages, the shared auth screens, and `/customer/**` are all one journey, so they
 * share one area rather than three.
 */
export const DEFAULT_AREA: ThemeArea = "customer";

/**
 * Longest-prefix-wins is done by ordering, not by length: `/admin` and `/staff`
 * cannot nest, so an explicit table is clearer than string sorting.
 *
 * Only non-default areas appear here. `/customer` is deliberately absent — it
 * resolves through {@link DEFAULT_AREA}, which means a new customer route cannot
 * be added without also remembering to register it.
 */
const AREA_PREFIXES: ReadonlyArray<readonly [ThemeArea, string]> = [
  ["admin", "/admin"],
  ["admin", "/staff"],
];

export function themeAreaForPath(pathname: string): ThemeArea {
  for (const [area, prefix] of AREA_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return area;
  }
  return DEFAULT_AREA;
}

export function themeStorageKey(area: ThemeArea): string {
  return `theme:${area}`;
}

/**
 * The single global key that predates per-area themes. Read last and folded
 * forward, so somebody who set a preference before the split keeps it instead of
 * silently reverting to the default.
 */
const LEGACY_GLOBAL_KEY = "theme";

/**
 * Keys an area's preference may live under, most specific first. Index 0 is
 * canonical; anything found further down is a retired key and gets folded into
 * the canonical one on first read.
 *
 *  - `theme:staff` retired when the staff workspace joined the admin area.
 *  - `theme:site` retired when the marketing pages joined the customer area. This
 *    one matters most: somebody who chose dark on the home page and never opened
 *    their dashboard would otherwise land on light and conclude the toggle is
 *    broken.
 */
const RETIRED_AREA_KEYS: Readonly<Record<ThemeArea, readonly string[]>> = {
  admin: ["theme:staff"],
  customer: ["theme:site"],
};

export function themeStorageCandidates(area: ThemeArea): readonly string[] {
  return [themeStorageKey(area), ...RETIRED_AREA_KEYS[area], LEGACY_GLOBAL_KEY];
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * The browser-chrome colours, matching `--brand` in each theme.
 *
 * Kept as literals because the `<meta name="theme-color">` tag cannot be styled
 * from CSS: it is the one part of the theme the cascade has no reach over.
 */
const THEME_COLOR: Record<Theme, string> = {
  light: "#d38a16",
  dark: "#efb255",
};

/**
 * Apply a theme to the live document.
 *
 * The only place in the app that writes `data-theme` after hydration, so the
 * attribute and the browser chrome can never disagree — which is how a dark page
 * ends up under an amber toolbar.
 *
 * Takes the document as an argument rather than reaching for the global one, so
 * it stays testable and so importing this module from a server component is not a
 * hazard. The pre-paint bootstrap sets the attribute itself, before any of this
 * runs, and corrects the chrome immediately after hydration.
 */
export function applyDocumentTheme(doc: Document, theme: Theme): void {
  const root = doc.documentElement;
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme;
  }
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLOR[theme];
  }
}

export type ThemeResolution = {
  theme: Theme;
  /** The retired key the value was found under, or `null` when it was current. */
  migratedFrom: string | null;
};

/**
 * Resolve an area's theme from storage, without touching `localStorage` directly
 * so it can be tested and so the same order is used everywhere.
 *
 * A hand-edited or corrupted value is skipped rather than applied: the scan
 * continues to the next candidate, and a storage with nothing usable resolves to
 * the default instead of leaving the document unthemed.
 */
export function resolveTheme(area: ThemeArea, read: (key: string) => string | null): ThemeResolution {
  const keys = themeStorageCandidates(area);
  for (let index = 0; index < keys.length; index += 1) {
    const value = read(keys[index]);
    if (isTheme(value)) {
      return { theme: value, migratedFrom: index === 0 ? null : keys[index] };
    }
  }
  return { theme: DEFAULT_THEME, migratedFrom: null };
}

/**
 * Pre-paint bootstrap, inlined into the document head.
 *
 * This has to run before the first paint or a dark-mode admin opening a
 * light customer page would see a white flash. It is emitted as a string because
 * it is a `<script>` in the document, so it cannot import anything.
 *
 * Rather than hand-writing a second copy of the rules — which is how the area
 * table and this script drifted apart before — it is **generated** from
 * {@link AREA_PREFIXES}, {@link themeStorageCandidates} and {@link DEFAULT_THEME}.
 * Adding a prefix or a retired key in one place changes both.
 *
 * Escaping is not a concern: the only interpolated values are literals from this
 * module, serialised with `JSON.stringify`.
 */
export function themeBootstrapScript(): string {
  const condition = ([, prefix]: readonly [ThemeArea, string]) =>
    `(p === ${JSON.stringify(prefix)} || p.indexOf(${JSON.stringify(`${prefix}/`)}) === 0) ? ${JSON.stringify(
      AREA_PREFIXES.find(([, value]) => value === prefix)?.[0],
    )}`;

  const chain = [condition(AREA_PREFIXES[0]), ...AREA_PREFIXES.slice(1).map(condition)].join(
    "\n      : ",
  );

  // Every area's key order, plus the default's, so the script has no logic of its
  // own to disagree with.
  const keysByArea: Record<string, readonly string[]> = {
    ...(Object.fromEntries(
      (["customer", "admin"] as ThemeArea[]).map((area) => [area, themeStorageCandidates(area)]),
    ) as Record<ThemeArea, readonly string[]>),
  };
  const fallback = themeStorageCandidates(DEFAULT_AREA);

  return `(() => {
  try {
    var p = location.pathname;
    var area = ${chain}
      : ${JSON.stringify(DEFAULT_AREA)};
    var keys = ${JSON.stringify(keysByArea)}[area] || ${JSON.stringify(fallback)};
    var theme = ${JSON.stringify(DEFAULT_THEME)}, from = -1;
    for (var i = 0; i < keys.length; i++) {
      var value = localStorage.getItem(keys[i]);
      if (value === "dark" || value === "light") { theme = value; from = i; break; }
    }
    // Fold a retired key forward once, rather than re-reading it on every load.
    if (from > 0) localStorage.setItem(keys[0], theme);
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
})()`;
}