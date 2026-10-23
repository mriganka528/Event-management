import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeNavLabel, activeRoutes, filterNavigation, isActiveRoute, normalizePath } from "@/lib/admin-navigation";

/**
 * Sidebar highlighting.
 *
 * Every entry used to be de-duplicated against the whole list, so `/admin`
 * matched as a "parent" of every other admin route and suppressed all of them.
 * The only link that ever lit up was the dashboard, whether the operator
 * clicked it or was redirected there.
 */
const navigation = [
  { href: "/admin", label: "Dashboard" },
  { href: "/staff", label: "Staff view" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/invoices", label: "Invoices" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/admins", label: "Admins" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/settings/credentials", label: "My credentials" },
  { href: "/admin/settings", label: "Settings" },
];

function activeLabels(pathname: string) {
  return navigation.filter((entry) => isActiveRoute(pathname, entry.href, navigation)).map((entry) => entry.label);
}

test("every admin route highlights its own link", () => {
  for (const entry of navigation) {
    assert.deepEqual(activeLabels(entry.href), [entry.label], `${entry.href} must highlight only "${entry.label}"`);
  }
});

test("nested routes highlight the most specific link", () => {
  assert.deepEqual(activeLabels("/admin/bookings/abc123"), ["Bookings"]);
  assert.deepEqual(activeLabels("/admin/settings/credentials"), ["My credentials"]);
  // The dashboard is the only entry that owns itself; no other admin route
  // may light it up.
  assert.deepEqual(activeLabels("/admin/inventory"), ["Inventory"]);
  assert.deepEqual(activeLabels("/admin"), ["Dashboard"]);
});

test("a nested route never lights up two links at once", () => {
  // The regression: the de-duplication only compared `path` against
  // `child + "/"`, which is never true for the child itself. So
  // `/admin/settings/credentials` lit "Settings" too, and `/admin/events` left
  // "Dashboard" lit because nothing appeared to own the path more deeply.
  for (const entry of navigation) {
    assert.deepEqual(activeLabels(entry.href), [entry.label], `${entry.href} must highlight exactly one link`);
  }
  // And for a path nested under any entry.
  for (const entry of navigation) {
    const nested = `${entry.href}/anything`;
    assert.deepEqual(activeLabels(nested), [entry.label], `${nested} must highlight exactly one link`);
  }
});

test("the dashboard is not highlighted once you leave it", () => {
  assert.deepEqual(activeLabels("/admin/events"), ["Events"]);
  assert.deepEqual(activeLabels("/admin/bookings/abc123"), ["Bookings"]);
  assert.deepEqual(activeLabels("/admin/settings/credentials"), ["My credentials"]);
  assert.equal(activeLabels("/admin/events").includes("Dashboard"), false);
});

test("a redirect to the dashboard still highlights the dashboard", () => {
  assert.deepEqual(activeLabels("/admin/dashboard"), ["Dashboard"]);
});

test("trailing slashes, index segments, and query strings are ignored", () => {
  assert.equal(normalizePath("/admin/services/"), "/admin/services");
  assert.equal(normalizePath("/admin/services?ref=nav#top"), "/admin/services");
  assert.deepEqual(activeLabels("/admin/services/"), ["Services"]);
  assert.deepEqual(activeLabels("/admin/services?ref=nav"), ["Services"]);
});

test("a path outside the sidebar highlights nothing", () => {
  assert.deepEqual(activeLabels("/customer/dashboard"), []);
  assert.deepEqual(activeLabels("/"), []);
});

test("an unknown admin sub-path falls back to the dashboard", () => {
  // Nothing more specific owns the path, so the nearest owning entry wins. The
  // alternative — highlighting nothing — leaves an operator on a 404 with no
  // idea which section they are in.
  assert.deepEqual(activeLabels("/admin/unknown-page"), ["Dashboard"]);
});

test("activeRoutes never returns more than one href", () => {
  for (const entry of navigation) {
    const active = activeRoutes(entry.href, navigation);
    assert.deepEqual(active, [entry.href], `${entry.href} must resolve to exactly itself`);
  }
});

test("activeNavLabel answers with the visible label", () => {
  assert.equal(activeNavLabel("/admin/inventory", navigation), "Inventory");
  assert.equal(activeNavLabel("/nope", navigation), null);
});

/*
 * The sidebar search.
 *
 * The list is short and the labels are the obvious ones, which is exactly why a
 * search needs a rule rather than a substring: somebody who thinks of the
 * inventory screen as "stock" has to land on it, and somebody typing "admin"
 * must not be handed every link — a search that returns the whole list is
 * indistinguishable from a search that did nothing.
 */
const searchable = [
  { href: "/admin", label: "Dashboard", keywords: ["home", "overview"] },
  { href: "/admin/bookings", label: "Bookings", keywords: ["orders", "quotes"] },
  { href: "/admin/inventory", label: "Inventory", keywords: ["stock", "equipment"] },
  { href: "/admin/payments", label: "Payments", keywords: ["money", "razorpay"] },
  { href: "/admin/settings/credentials", label: "My credentials", keywords: ["password", "login"] },
];

function labels(query: string) {
  return filterNavigation(query, searchable).map((entry) => entry.label);
}

test("an empty search returns every link, in its original order", () => {
  assert.deepEqual(labels(""), searchable.map((entry) => entry.label));
  assert.deepEqual(labels("   "), searchable.map((entry) => entry.label));
});

test("a link is found by its label, whatever the case", () => {
  assert.deepEqual(labels("inventory"), ["Inventory"]);
  assert.deepEqual(labels("INVENTORY"), ["Inventory"]);
  assert.deepEqual(labels("invent"), ["Inventory"], "a partial word still finds the page");
  assert.deepEqual(labels("book"), ["Bookings"]);
});

test("a link is found by a word it does not display", () => {
  // The reason keywords exist: the label is what the operator reads, the
  // keywords are what they type.
  assert.deepEqual(labels("stock"), ["Inventory"]);
  assert.deepEqual(labels("equipment"), ["Inventory"]);
  assert.deepEqual(labels("money"), ["Payments"]);
  assert.deepEqual(labels("password"), ["My credentials"]);
});

test("every term has to match, so several words narrow rather than widen", () => {
  assert.deepEqual(labels("inventory stock"), ["Inventory"], "both terms are in this entry");
  assert.deepEqual(labels("inventory payments"), [], "two terms pointing at different pages match neither");
  assert.deepEqual(labels("staff booking"), [], "no entry is both");
  // A term nothing matches rules the entry out, which is what makes "admin"
  // harmless below.
  assert.deepEqual(labels("admin stock"), []);
});

test("the href is not searched, or 'admin' would return everything", () => {
  // Every admin entry begins `/admin`, so matching the path would make this query
  // return the whole list — a search that looks broken rather than empty.
  assert.deepEqual(labels("admin"), []);
  assert.deepEqual(labels("/admin/inventory"), []);
});

test("a search nothing matches returns nothing, rather than everything", () => {
  // The dangerous failure: a filter that quietly falls back to the full list is
  // indistinguishable from a filter that was never applied.
  assert.deepEqual(labels("helicopter"), []);
  assert.deepEqual(labels("xyzzy"), []);
});

test("the result is a copy, so a caller cannot reorder the navigation itself", () => {
  const all = filterNavigation("", searchable);
  assert.notEqual(all, searchable);
  assert.deepEqual(all.map((entry) => entry.href), searchable.map((entry) => entry.href));
});

test("an entry without keywords is matched on its label alone", () => {
  assert.deepEqual(
    filterNavigation("staff", [{ href: "/admin/staff", label: "Staff" }]).map((entry) => entry.label),
    ["Staff"],
  );
  assert.deepEqual(filterNavigation("team", [{ href: "/admin/staff", label: "Staff" }]), []);
});

test("the sidebar renders the search and the list it narrows", () => {
  // The rule and the field are separate pieces: a sidebar that lists every link
  // no matter what is typed still passes every test above, and looks broken.
  const sidebar = readFileSync("app/(admin)/admin/component/admin-sidebar.tsx", "utf8");
  assert.match(sidebar, /filterNavigation\(query, navigation\)/, "the list on screen must be the filtered one");
  assert.match(sidebar, /type="search"/);
  assert.match(sidebar, /aria-label="Search sidebar pages"/);
  // Escape clears, and there is a way to clear without a keyboard.
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /aria-label="Clear the page search"/);
  // No matches has to say so: an empty list with no explanation reads as a
  // sidebar that failed to load.
  assert.match(sidebar, /No page matches/);

  /*
   * Both copies of the sidebar are mounted at once — the drawer and the fixed
   * one — so an `id` in here would appear twice on the page, and a `<label for>`
   * would end up naming the copy nobody is looking at.
   */
  assert.doesNotMatch(sidebar.slice(sidebar.indexOf('role="search"'), sidebar.indexOf("</form>")), /\bid=/, "the search field must not use an id");
  assert.doesNotMatch(sidebar, /<label htmlFor=/, "no `for`/`id` pair may target one of the two copies");

  // Every link answers to at least the words an operator would reach for.
  const entries = [...sidebar.matchAll(/label: "([^"]+)", icon: \w+, keywords: \[([^\]]*)\]/g)];
  assert.equal(entries.length, 18, "every link should carry keywords");
  for (const [, label, keywords] of entries) {
    assert.ok(keywords.includes('"'), `${label} has an empty keyword list`);
  }
});

