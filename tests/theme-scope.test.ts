import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_AREA,
  DEFAULT_THEME,
  applyDocumentTheme,
  isTheme,
  resolveTheme,
  themeAreaForPath,
  themeBootstrapScript,
  themeStorageCandidates,
  themeStorageKey,
  type ThemeArea,
} from "../lib/theme-scope";

/**
 * Theme scoping contract.
 *
 * There are exactly two themes. `customer` covers the whole customer journey —
 * the marketing pages, the sign-in and account panels, the booking form — because
 * those used to be separate areas, which is why a customer who chose dark on the
 * home page met a light booking form. `admin` covers the admin panel and the
 * staff workspace together, since both are the same business running its own
 * screens. Neither reads the other's value.
 *
 * The default is light, unconditionally. It used to fall through to
 * `prefers-color-scheme`, so a visitor on a dark-mode device was shown dark with
 * no indication of who had chosen it — which reads as a broken toggle.
 *
 * The interesting part is that the pre-paint bootstrap script cannot import
 * anything, so it implements these rules a second time. It is now *generated*
 * from the same tables, and the tests below execute it against a fake browser and
 * compare the result with `resolveTheme`, so the two copies cannot drift.
 */

// ---------------------------------------------------------------------------
// A fake browser for the inline bootstrap script.
// ---------------------------------------------------------------------------

type Storage = Record<string, string>;

/**
 * A file's source with its comments removed.
 *
 * The comments here explain what was *removed* as much as what is there, so prose
 * about `prefers-color-scheme` would otherwise read as a call to it. Anything
 * asserting what the code does runs against this.
 */
const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

type BootstrapResult = {
  applied: string | undefined;
  storage: Storage;
};

/**
 * The sliver of `Document` that {@link applyDocumentTheme} touches.
 *
 * There is no DOM in this test runner, and a full fake would test the fake. This
 * provides exactly `documentElement.dataset` and the theme-color meta elements,
 * which is the whole surface the function uses.
 */
function fakeDocument(): {
  documentElement: { dataset: Record<string, string> };
  metas: Array<{ content: string }>;
  querySelectorAll: (selector: string) => Array<{ content: string }>;
} {
  const metas = [{ content: "" }];
  return {
    documentElement: { dataset: {} },
    metas,
    querySelectorAll: (selector) => (selector.includes("theme-color") ? metas : []),
  };
}

/**
 * Runs the generated script against a stubbed `location`/`localStorage`/`document`.
 *
 * The stub `window` deliberately throws from `matchMedia`: the bootstrap must set
 * a theme before the first paint, and a theme that depended on the operating
 * system would flash the wrong one and then correct itself.
 */
function runBootstrap(pathname: string, initial: Storage = {}): BootstrapResult {
  const storage: Storage = { ...initial };
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  const hostileWindow = {
    matchMedia() {
      throw new Error("the bootstrap must not consult prefers-color-scheme");
    },
  };

   
  const run = new Function("location", "localStorage", "document", "window", themeBootstrapScript());
  run(
    { pathname },
    {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    },
    document,
    hostileWindow,
  );

  return { applied: document.documentElement.dataset.theme, storage };
}

// ---------------------------------------------------------------------------

// Paths that must resolve to each area: the exact prefix with no trailing slash,
// a nested route, and a lookalike that must NOT match.
const AREA_CASES: Array<[string, ThemeArea]> = [
  // The customer journey, end to end.
  ["/", "customer"],
  ["/packages", "customer"],
  ["/packages/some-slug", "customer"],
  ["/services", "customer"],
  ["/services/some-slug", "customer"],
  ["/contact", "customer"],
  ["/sign-in", "customer"],
  ["/auth-choice", "customer"],
  ["/join-the-team", "customer"],
  ["/activate", "customer"],
  ["/customer", "customer"],
  ["/customer/dashboard", "customer"],
  ["/customer/bookings/new", "customer"],
  ["/customer/bookings/some-id", "customer"],
  ["/customer/auth/sign-in", "customer"],
  ["/customer/auth/sign-up", "customer"],
  // The business workspaces, which now share one area.
  ["/admin", "admin"],
  ["/admin/admins", "admin"],
  ["/admin/staff", "admin"],
  ["/admin/settings/credentials", "admin"],
  ["/staff", "admin"],
  ["/staff/pending", "admin"],
  ["/staff/invite/some-token", "admin"],
  // Lookalikes: a longer segment that merely starts with the same letters.
  ["/administrator", "customer"],
  ["/staffing", "customer"],
  ["/customers", "customer"],
  ["/customer-extra", "customer"],
];

test("there are two areas, and routes resolve to them by exact prefix", () => {
  for (const [pathname, expected] of AREA_CASES) {
    assert.equal(themeAreaForPath(pathname), expected, `${pathname} should be in the "${expected}" area`);
  }
});

test("the customer journey is one area, not several", () => {
  // The reason this changed: a customer who picked dark on the home page met a
  // light booking form, because the marketing pages and the portal were separate
  // areas with separate keys.
  const journey = [
    "/",
    "/packages",
    "/packages/some-slug",
    "/sign-in",
    "/auth-choice",
    "/customer/dashboard",
    "/customer/bookings/new",
    "/customer/auth/sign-in",
  ];
  for (const pathname of journey) {
    assert.equal(themeAreaForPath(pathname), "customer", `${pathname} broke away from the customer journey`);
  }
});

test("the staff workspace shares the admin area", () => {
  assert.equal(themeAreaForPath("/staff"), themeAreaForPath("/admin"));
  assert.equal(themeAreaForPath("/staff/pending"), themeAreaForPath("/admin/bookings"));
});

test("each area stores its preference under its own key", () => {
  // The whole point of the split: one area's write must not be readable by the
  // other, so the keys must differ.
  const areas: ThemeArea[] = ["customer", "admin"];
  const keys = areas.map(themeStorageKey);
  assert.equal(new Set(keys).size, keys.length, `theme keys collide: ${keys.join(", ")}`);
  for (const key of keys) {
    assert.match(key, /^theme:[a-z]+$/, `"${key}" should be a namespaced theme key`);
  }
});

test("the default is light, and the operating system is never consulted", () => {
  assert.equal(DEFAULT_THEME, "light");
  assert.equal(DEFAULT_AREA, "customer");

  // The behaviour that made this feel broken: an unset preference used to resolve
  // from `prefers-color-scheme`, so a dark-mode device silently got dark.
  for (const file of [
    "lib/theme-scope.ts",
    "components/marketing/theme-toggle.tsx",
    "components/marketing/theme-scope-sync.tsx",
    "app/layout.tsx",
  ]) {
    assert.doesNotMatch(
      code(file),
      /matchMedia|prefers-color-scheme/,
      `${file} consults the operating system, so an unset theme is not the light default`,
    );
  }

  // …and the generated script cannot reach it either.
  assert.doesNotMatch(themeBootstrapScript(), /matchMedia|prefers-color-scheme/);
});

test("only light and dark are accepted as stored values", () => {
  assert.equal(isTheme("light"), true);
  assert.equal(isTheme("dark"), true);
  // Anything else must be skipped rather than applied, which is what keeps a
  // hand-edited or corrupted value from breaking the page.
  for (const junk of ["", "auto", "Dark", "DARK", "system", null, undefined, 1, {}]) {
    assert.equal(isTheme(junk), false, `${JSON.stringify(junk)} must not be treated as a theme`);
  }
});

test("a corrupt value is skipped and the scan continues", () => {
  const read = (storage: Storage) => (key: string) => (key in storage ? storage[key] : null);
  const store: Storage = { "theme:customer": "neon", "theme:site": "dark" };
  // Not a theme, so the retired key behind it is used instead of rendering a
  // broken page.
  assert.deepEqual(resolveTheme("customer", read(store)), { theme: "dark", migratedFrom: "theme:site" });
  // Nothing usable anywhere resolves to the default rather than to `undefined`.
  assert.deepEqual(resolveTheme("customer", read({ "theme:customer": "neon" })), {
    theme: "light",
    migratedFrom: null,
  });
});

test("a preference set before the split is carried forward, not lost", () => {
  const read = (storage: Storage) => (key: string) => (key in storage ? storage[key] : null);

  // Somebody who chose dark on the marketing site and never opened their
  // dashboard. Without the carry-over they would land on light and conclude the
  // toggle is broken.
  assert.deepEqual(resolveTheme("customer", read({ "theme:site": "dark" })), {
    theme: "dark",
    migratedFrom: "theme:site",
  });
  // A staff member's preference moves to the admin area rather than resetting.
  assert.deepEqual(resolveTheme("admin", read({ "theme:staff": "dark" })), {
    theme: "dark",
    migratedFrom: "theme:staff",
  });
  // The original single global key is still honoured, for both areas.
  assert.deepEqual(resolveTheme("customer", read({ theme: "dark" })), { theme: "dark", migratedFrom: "theme" });
  assert.deepEqual(resolveTheme("admin", read({ theme: "dark" })), { theme: "dark", migratedFrom: "theme" });

  // And a current value always wins over a retired one.
  assert.deepEqual(resolveTheme("customer", read({ "theme:customer": "light", "theme:site": "dark" })), {
    theme: "light",
    migratedFrom: null,
  });
});

test("retired keys are only ever a fallback, never a source", () => {
  // The old global key used to be read unconditionally, which let it override a
  // per-area choice on every load. It must be dead last in every candidate list.
  for (const area of ["customer", "admin"] as ThemeArea[]) {
    const keys = themeStorageCandidates(area);
    assert.equal(keys[0], themeStorageKey(area), `${area} must read its own key first`);
    assert.equal(keys.at(-1), "theme", `${area} must consult the legacy global key last`);
    assert.equal(new Set(keys).size, keys.length, `${area} has duplicate candidates: ${keys.join(", ")}`);
  }
});

test("the inline bootstrap agrees with the TypeScript helper, on every route", () => {
  // The bootstrap is a `<script>` and cannot import, so it carries its own copy of
  // the rules. It is generated from the same tables, and this executes it rather
  // than scraping it, so the two cannot disagree about what a path resolves to or
  // which key holds its preference.
  for (const [pathname, expected] of AREA_CASES) {
    const store: Storage = {
      "theme:customer": "dark",
      "theme:site": "light",
      "theme:admin": "light",
      "theme:staff": "dark",
      theme: "dark",
    };
    const read = (key: string) => (key in store ? store[key] : null);

    assert.equal(
      runBootstrap(pathname, store).applied,
      resolveTheme(expected, read).theme,
      `${pathname}: the pre-paint script and the helper disagree`,
    );
  }
});

test("the bootstrap defaults to light and folds retired keys forward", () => {
  // Empty storage: light, for every area, without asking the operating system.
  assert.equal(runBootstrap("/").applied, "light");
  assert.equal(runBootstrap("/customer/bookings/new").applied, "light");
  assert.equal(runBootstrap("/admin/settings").applied, "light");

  // A value under a retired key is applied now and written into the current key,
  // so the migration happens once rather than on every page load.
  const migrated = runBootstrap("/customer/bookings/new", { "theme:site": "dark" });
  assert.equal(migrated.applied, "dark");
  assert.equal(migrated.storage["theme:customer"], "dark");

  const staff = runBootstrap("/staff/pending", { "theme:staff": "dark" });
  assert.equal(staff.applied, "dark");
  assert.equal(staff.storage["theme:admin"], "dark");

  // An already-current value is left alone, with no redundant write.
  const current = runBootstrap("/", { "theme:customer": "dark" });
  assert.equal(current.applied, "dark");
  assert.deepEqual(current.storage, { "theme:customer": "dark" });
});

test("the two areas never bleed into each other", () => {
  // The behaviour the split exists for, checked end to end through the script
  // that actually runs before paint.
  const store: Storage = { "theme:customer": "dark", "theme:admin": "light" };
  assert.equal(runBootstrap("/packages", store).applied, "dark");
  assert.equal(runBootstrap("/customer/bookings/new", store).applied, "dark");
  assert.equal(runBootstrap("/sign-in", store).applied, "dark");
  assert.equal(runBootstrap("/admin", store).applied, "light");
  assert.equal(runBootstrap("/staff", store).applied, "light");

  // …and the reverse.
  const reversed: Storage = { "theme:customer": "light", "theme:admin": "dark" };
  assert.equal(runBootstrap("/", reversed).applied, "light");
  assert.equal(runBootstrap("/admin/bookings", reversed).applied, "dark");
});

test("the bootstrap cannot break the page when storage is unavailable", () => {
  // Private mode, a storage-denied origin: the script has to swallow it rather
  // than leave the document unthemed, which would render it with no palette at
  // all.
  const script = themeBootstrapScript();
  assert.match(script, /catch \(_\) \{\}/, "the bootstrap must tolerate storage being unavailable");

   
  const run = new Function("location", "localStorage", "document", script);
  assert.doesNotThrow(() =>
    run(
      { pathname: "/admin" },
      {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
      },
      { documentElement: { dataset: {} } },
      {},
    ),
  );
});

test("the browser chrome follows the theme, not a fixed brand colour", () => {
  // `<meta name="theme-color">` is the one part of the theme the cascade cannot
  // reach, so a dark page was left with an amber toolbar above it.
  const light = fakeDocument();
  applyDocumentTheme(light as unknown as Document, "light");
  assert.equal(light.documentElement.dataset.theme, "light");
  assert.equal(light.metas[0].content, "#d38a16");

  const dark = fakeDocument();
  applyDocumentTheme(dark as unknown as Document, "dark");
  assert.equal(dark.documentElement.dataset.theme, "dark");
  assert.equal(dark.metas[0].content, "#efb255");

  // …and those literals are pinned to the tokens in the stylesheet, because a
  // palette tweak in `globals.css` should not leave the toolbar behind.
  const css = readFileSync("app/globals.css", "utf8");
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
  assert.equal(/--brand:\s*([^;]+);/.exec(css)?.[1].trim(), "#d38a16", "the light --brand moved; THEME_COLOR must follow it");
  assert.equal(/--brand:\s*([^;]+);/.exec(darkBlock)?.[1].trim(), "#efb255", "the dark --brand moved; THEME_COLOR must follow it");
});

test("nothing request-controlled is interpolated into the inline script", () => {
  // The script is inlined into every response head.
  const script = themeBootstrapScript();
  assert.equal(script.includes("${"), false, "the bootstrap must not interpolate anything into the inline script");
  assert.match(script, /document\.documentElement\.dataset\.theme = theme/, "the bootstrap must set data-theme before paint");
});

test("no component reads the old unscoped theme key as its source", () => {
  // A leftover `localStorage.getItem("theme")` outside the one-time carry-over
  // would silently reintroduce global coupling: whichever area rendered first
  // would win for all of them. The key now lives in one table in `lib/theme-scope`
  // and is only ever reached through `resolveTheme`'s candidate list.
  for (const file of [
    "components/marketing/theme-toggle.tsx",
    "components/marketing/theme-scope-sync.tsx",
    "app/layout.tsx",
  ]) {
    assert.doesNotMatch(
      code(file),
      /getItem\(\s*["'`]theme["'`]\s*\)/,
      `${file} still reads the unscoped "theme" key, which couples both areas together`,
    );
  }
});

test("both areas can change their theme without a toggle of the other", () => {
  // Each area needs its own control, or the independence is invisible.
  const AREA_TOGGLES: Array<[ThemeArea, string]> = [
    ["customer", "components/layout/site-header.tsx"],
    ["customer", "app/(customer)/customer/layout.tsx"],
    ["admin", "app/(admin)/admin/component/admin-sidebar.tsx"],
    ["admin", "app/(staff)/staff/layout.tsx"],
  ];

  for (const [area, file] of AREA_TOGGLES) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /<ThemeToggle\s*\/>/,
      `the ${area} area has no ThemeToggle, so its theme cannot be changed without going to the other area (${file})`,
    );
  }

  // And the document value must be corrected on navigation regardless, because
  // the toggle is not the only thing that writes it — crossing between the two
  // areas is the ordinary case now.
  const rootLayout = readFileSync("app/layout.tsx", "utf8");
  assert.match(rootLayout, /ThemeScopeSync/, "the root layout must mount ThemeScopeSync");

  const sync = readFileSync("components/marketing/theme-scope-sync.tsx", "utf8");
  assert.match(sync, /usePathname/, "ThemeScopeSync must track the current route");
  assert.match(
    sync,
    /applyDocumentTheme\(document, theme\)/,
    "ThemeScopeSync must apply the area's theme to the document",
  );

  // One writer, or the attribute and the browser chrome drift apart — which is
  // how a dark page ends up under a light toolbar.
  for (const file of [
    "components/marketing/theme-toggle.tsx",
    "components/marketing/theme-scope-sync.tsx",
  ]) {
    assert.doesNotMatch(
      code(file),
      /documentElement\.dataset\.theme/,
      `${file} writes data-theme directly instead of going through applyDocumentTheme`,
    );
  }
});