import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { themeAreaForPath, themeBootstrapScript, themeStorageKey, isTheme, type ThemeArea } from "../lib/theme-scope";

/**
 * Theme scoping contract.
 *
 * Themes used to live in a single `localStorage.theme` key, so one preference
 * applied everywhere: a customer who chose dark mode on the marketing site got
 * the staff workspace's theme too, and an admin could not keep the public site
 * light without flipping the panel. Each area now keeps its own value.
 *
 * The interesting part is that `themeAreaForPath` and the inline bootstrap
 * script implement the same rules twice — once in TypeScript and once as a
 * string that cannot import anything. The tests below execute the string's own
 * logic against the same path table so the two copies cannot drift apart.
 */

// Paths that must resolve to each area, including the exact prefix with no
// trailing slash, a nested route, and a lookalike that must NOT match.
const AREA_CASES: Array<[string, string]> = [
  ["/", "site"],
  ["/packages", "site"],
  ["/packages/some-slug", "site"],
  ["/services", "site"],
  ["/contact", "site"],
  ["/sign-in", "site"],
  ["/auth-choice", "site"],
  ["/join-the-team", "site"],
  ["/admin", "admin"],
  ["/admin/admins", "admin"],
  ["/admin/staff", "admin"],
  ["/admin/settings/credentials", "admin"],
  ["/staff", "staff"],
  ["/staff/pending", "staff"],
  ["/staff/invite/some-token", "staff"],
  ["/customer", "customer"],
  ["/customer/dashboard", "customer"],
  ["/customer/bookings/new", "customer"],
  ["/customer/bookings/some-id", "customer"],
  ["/customer/auth/sign-in", "customer"],
  // Lookalikes: a longer segment that merely starts with the same letters.
  ["/administrator", "site"],
  ["/staffing", "site"],
  ["/customers", "site"],
  ["/customer-extra", "site"],
];

test("each area is resolved by exact prefix, not a loose startsWith", () => {
  for (const [pathname, expected] of AREA_CASES) {
    assert.equal(themeAreaForPath(pathname), expected, `${pathname} should be in the "${expected}" area`);
  }
});

test("every area stores its preference under its own key", () => {
  // The whole point of the change: one area's write must not be readable by
  // another, so the keys must all differ.
  const keys = (["site", "admin", "staff", "customer"] as ThemeArea[]).map(themeStorageKey);
  assert.equal(new Set(keys).size, keys.length, `theme keys collide: ${keys.join(", ")}`);
  for (const key of keys) {
    assert.match(key, /^theme:[a-z]+$/, `"${key}" should be a namespaced theme key`);
  }
});

test("only light and dark are accepted as stored values", () => {
  assert.equal(isTheme("light"), true);
  assert.equal(isTheme("dark"), true);
  // Anything else must fall back to the OS preference rather than being applied,
  // which is what keeps a hand-edited or corrupted value from breaking the page.
  for (const junk of ["", "auto", "Dark", "DARK", "system", null, undefined, 1, {}]) {
    assert.equal(isTheme(junk), false, `${JSON.stringify(junk)} must not be treated as a theme`);
  }
});

test("the inline bootstrap resolves the same areas as the TypeScript helper", () => {
  // The bootstrap script is a string and cannot import the helper above, so its
  // copy of the rules is extracted and compared. If someone edits one and not the
  // other, the document would be painted with one area's theme while React
  // believed it was in another — a flash, then a silent correction.
  const script = themeBootstrapScript();

  const rules = [
    ...script.matchAll(/p === "(\/[^"]+)" \|\| p\.indexOf\("\1\/"\) === 0\) \? "(\w+)"/g),
  ];
  assert.equal(rules.length, 3, `expected three area rules in the bootstrap script, found ${rules.length}`);

  for (const rule of rules) {
    const prefix = rule[1] as string;
    const area = rule[2] as string;
    // The script's rule must agree with the shared helper on the exact prefix,
    // on a nested route, and on a lookalike that must not match.
    assert.equal(themeAreaForPath(prefix), area, `bootstrap maps ${prefix} to ${area}, helper disagrees`);
    assert.equal(
      themeAreaForPath(`${prefix}/something-else`),
      area,
      `bootstrap maps ${prefix}/something-else to ${area}, helper disagrees`,
    );
    assert.equal(
      themeAreaForPath(`${prefix}suffix`),
      "site",
      `bootstrap must not treat ${prefix}suffix as ${area}`,
    );
  }

  // Every area the helper knows about must be covered by the script, otherwise a
  // new area would silently fall back to the public theme.
  const scriptAreas = new Set(rules.map((rule) => rule[2]));
  for (const area of ["admin", "staff", "customer"]) {
    assert.ok(scriptAreas.has(area), `the bootstrap script has no rule for the "${area}" area`);
  }
});

test("the bootstrap script reads the scoped key and writes data-theme", () => {
  const script = themeBootstrapScript();
  assert.match(script, /localStorage\.getItem\(key\)/, "the bootstrap must read the namespaced key");
  assert.match(script, /"theme:" \+ area/, "the bootstrap must build the namespaced key from the area");
  assert.match(script, /document\.documentElement\.dataset\.theme = theme/, "the bootstrap must set data-theme before paint");
  // It runs inside a try/catch so a storage-denied origin cannot leave the
  // document unthemed and therefore broken.
  assert.match(script, /catch \(_\) \{\}/, "the bootstrap must tolerate storage being unavailable");
  // Nothing request-controlled may be interpolated into an inline script.
  assert.equal(script.includes("${"), false, "the bootstrap must not interpolate anything into the inline script");
});

test("no component reads the old unscoped theme key as its source", () => {
  // A leftover `localStorage.getItem("theme")` outside the one-time carry-over
  // would silently reintroduce global coupling: whichever area rendered first
  // would win for all of them.
  for (const file of ["components/marketing/theme-toggle.tsx", "app/layout.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /getItem\(\s*["'`]theme["'`]\s*\)/,
      `${file} still reads the unscoped "theme" key, which couples every area together`,
    );
  }
});

test("the legacy key is only ever read as a one-time carry-over", () => {
  // Where the old key is still read, it must be gated on the scoped key being
  // absent and must be copied into the scoped key. Reading it unconditionally
  // would let the old global value override a per-area choice on every load.
  const files = ["lib/theme-scope.ts", "components/marketing/theme-scope-sync.tsx"];
  let readCount = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const legacyReads = source.match(/getItem\(\s*["'`]theme["'`]\s*\)/g) ?? [];
    readCount += legacyReads.length;

    for (const read of legacyReads) {
      const index = source.indexOf(read);
      const window = source.slice(Math.max(0, index - 200), index + 400);
      // It must be inside a "scoped value absent" branch.
      assert.match(
        window,
        /saved\s*===\s*null|===\s*null/,
        `${file} reads the legacy key without first checking that the scoped key is absent`,
      );
      // And the value must be migrated into the namespaced key, not just used.
      assert.match(
        window,
        /setItem\(\s*(key|themeStorageKey\([^)]*\))\s*,/,
        `${file} uses the legacy value without migrating it into the namespaced key`,
      );
    }
  }

  assert.ok(readCount > 0, "the one-time legacy carry-over should still exist somewhere");
});

test("every workspace can change its theme without a toggle of its own", () => {
  // The areas are independent, so each needs its own control. Before this, `/staff`
  // and `/customer` rendered no toggle at all: the only way to change theme from
  // inside those areas was the public site's control, which — while themes were
  // global — changed it everywhere.
  const AREA_LAYOUTS: Array<[string, string]> = [
    ["customer", "app/(customer)/customer/layout.tsx"],
    ["staff", "app/(staff)/staff/layout.tsx"],
    ["admin", "app/(admin)/admin/component/admin-sidebar.tsx"],
    ["site", "components/layout/site-header.tsx"],
  ];

  for (const [area, file] of AREA_LAYOUTS) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /<ThemeToggle\s*\/>/,
      `the ${area} area has no ThemeToggle, so its theme cannot be changed independently (${file})`,
    );
  }

  // And the document value must be corrected on navigation regardless, because
  // the toggle is not the only thing that writes it.
  const rootLayout = readFileSync("app/layout.tsx", "utf8");
  assert.match(rootLayout, /ThemeScopeSync/, "the root layout must mount ThemeScopeSync");

  const sync = readFileSync("components/marketing/theme-scope-sync.tsx", "utf8");
  assert.match(sync, /usePathname/, "ThemeScopeSync must track the current route");
  assert.match(sync, /dataset\.theme/, "ThemeScopeSync must apply the area's theme to the document");
});