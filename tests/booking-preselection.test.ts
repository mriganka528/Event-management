import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Choosing something on the public site and keeping it chosen.
 *
 * A customer opens a package or a service detail page, presses *Request*, and
 * arrives at the booking form expecting the thing they picked to already be
 * chosen. Nothing in the chain said so, and the last link was broken outright.
 *
 * `useState` evaluates its argument once, on the first render. Reaching the form
 * by *clicking* is a client-side transition from `/customer/bookings/new` to
 * `/customer/bookings/new?package=…`, which React treats as the same page: the
 * server component re-renders with the new search params, but the form component
 * is reused rather than remounted, so state seeded from those params keeps its
 * old value. Refreshing the same URL works, because that remounts — which is why
 * the feature read as intermittent rather than as absent.
 *
 * The two selections then need different repairs, and conflating them is the trap:
 *
 *  - a **package** is one choice that mirrors the URL, so it is simply re-seeded;
 *  - **services** are a running list of everything the customer has added, so it
 *    is only ever *added to*. Replacing it would throw away their own picks every
 *    time they followed a link, and re-seeding a quantity would reset a line from
 *    150 chairs back to 1.
 *
 * Checked against the source: none of this is visible to the type checker, and a
 * form that renders perfectly can still discard what the customer chose.
 */

/**
 * Comments carry the *why* in this codebase, and they end up sitting between the
 * code an assertion targets and the tokens that identify it. Stripping them keeps
 * every pattern below about the code, so a comment can be reworded, moved, or
 * added without a test failing for a reason that has nothing to do with behaviour.
 *
 * Line comments are only removed at the start of a line, so a `//` inside a
 * string — a URL — survives.
 */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const source = (path: string) => code(readFileSync(path, "utf8"));

const form = source("components/booking/booking-form.tsx");
const bookingPage = source("app/(customer)/customer/bookings/new/page.tsx");
const packageDetail = source("app/(root)/packages/[slug]/page.tsx");
const serviceDetail = source("app/(root)/services/[slug]/page.tsx");

test("the detail pages hand the chosen item to the booking form", () => {
  // Without this there is nothing to keep. By id, not by slug: the form validates
  // the value against the catalog it fetched, so a slug would be dropped there.
  assert.match(packageDetail, /href=\{`\/customer\/bookings\/new\?package=\$\{item\.id\}`\}/);
  assert.match(serviceDetail, /href=\{`\/customer\/bookings\/new\?service=\$\{service\.id\}`\}/);
  // The header's generic call to action must stay bare — it asks for nothing
  // specific, and inventing a preselection there would preselect nothing.
  assert.match(source("components/layout/site-header.tsx"), /href="\/customer\/bookings\/new"/);
});

test("the booking page reads both ids out of the query string", () => {
  assert.match(bookingPage, /searchParams: Promise<\{ package\?: string; service\?: string \}>/);
  // Bounded, because the query string is attacker-controlled and ends up in a
  // database lookup.
  assert.match(bookingPage, /typeof query\.package === "string" && query\.package\.length <= 100/);
  assert.match(bookingPage, /typeof query\.service === "string" && query\.service\.length <= 100/);
});

test("the page validates both ids against the catalog it fetched", () => {
  // A slug pointing at a deleted, deactivated or never-existed row has to leave
  // the form empty rather than select a line the server cannot price or fulfil.
  assert.match(bookingPage, /initialPackageId=\{packages\.some\(\(item\) => item\.id === requestedPackageId\) \? requestedPackageId : ""\}/);
  assert.match(bookingPage, /initialServiceId=\{services\.some\(\(item\) => item\.id === requestedServiceId\) \? requestedServiceId : ""\}/);
  // Dynamic, so the query string is read per request instead of being baked into
  // a statically generated page that would serve the first visitor's choice to
  // everybody.
  assert.match(bookingPage, /export const dynamic = "force-dynamic"/);
});

test("the form follows the requested package instead of only reading it once", () => {
  assert.match(form, /const \[packageId, setPackageId\] = useState\(initialPackageId\)/);
  assert.match(form, /useEffect\(\(\) => \{\s*setPackageId\(initialPackageId\);\s*\}, \[initialPackageId\]\)/);

  // Keyed on the incoming value alone. If this effect also depended on the current
  // selection it would fight the customer, putting the package back every time
  // they chose "Custom services".
  const effect = /useEffect\(\(\) => \{\s*setPackageId\(initialPackageId\);\s*\}, \[([^\]]*)\]\)/.exec(form);
  assert.ok(effect, "the sync effect is missing, so a link click loses the selection");
  assert.deepEqual(
    effect[1].split(",").map((entry) => entry.trim()),
    ["initialPackageId"],
    "the sync must depend on the requested package alone, or it overrides the customer's own choice",
  );
});

test("the requested service is seeded on the first render, not after hydration", () => {
  // A lazy initialiser, so the line exists in the server's markup. Seeding it in
  // an effect instead would paint an empty form and then change the total under
  // the customer's eyes.
  assert.match(form, /const \[selectedServices, setSelectedServices\] = useState<Record<string, number>>\(\(\) =>\s*initialServiceId \? \{ \[initialServiceId\]: 1 \} : \{\},?\s*\)/);
});

test("the service sync adds to the customer's list rather than replacing it", () => {
  // The behavioural difference from the package, and the reason the two cannot
  // share one fix: this state is everything they have added, not one choice.
  assert.match(form, /useEffect\(\(\) => \{\s*if \(!initialServiceId\) return;\s*setSelectedServices\(\(current\) => \(current\[initialServiceId\] \? current : \{ \.\.\.current, \[initialServiceId\]: 1 \}\)\);\s*\}, \[initialServiceId\]\)/);

  // Replacing the record, or re-seeding a quantity the customer has already set,
  // would both discard real work: a 150-chair line reset to 1.
  assert.doesNotMatch(
    form,
    /useEffect\(\(\) => \{\s*setSelectedServices\(\{ \[initialServiceId\]: 1 \}\);/,
    "the effect overwrites the customer's list instead of adding to it",
  );

  // Dropping the `service` parameter entirely must change nothing, so a customer
  // who reaches the bare form does not lose what they had already added.
  assert.match(form, /if \(!initialServiceId\) return;/);
});

test("the rest of the half-filled form survives the navigation", () => {
  // Guest count, added services and notes are the customer's own work, and
  // re-seeding them on every navigation would throw away what they typed to get
  // the page to change in the first place.
  assert.equal((form.match(/useState\(initial/g) ?? []).length, 1, "more than one piece of state is being re-seeded from a prop");
  assert.match(form, /const \[guestCount, setGuestCount\] = useState\("100"\)/);
});

test("a preselected item is visible as selected, not just held in state", () => {
  // A selection the customer cannot see is indistinguishable from one that did
  // not happen, which is the other half of "it is not working".
  assert.match(form, /name="packageId" value=\{item\.id\} checked=\{packageId === item\.id\}/);
  assert.match(form, /\$\{packageId === item\.id \? "border-amber-400 bg-amber-50"/);
  assert.match(form, /checked=\{selected\}/);
  assert.match(form, /\$\{unavailable && !selected \? "border-\[var\(--danger-text\)\]\/30 bg-\[var\(--danger-soft\)\]" : selected \? "border-amber-300 bg-amber-50\/60"/);
});

test("a preselected package is actually priced", () => {
  // Otherwise it looks chosen while contributing nothing to the quote.
  assert.match(form, /const packagePrice = selectedPackage \? Number\(selectedPackage\.price\) : 0;/);
  assert.match(form, /const subtotal = packagePrice \+ serviceTotal;/);
});

test("an out-of-stock service is still preselected rather than silently dropped", () => {
  // The customer asked for it by name. Landing on a form that explains the
  // shortage and lets them reduce or drop the line is honest; landing on a form
  // with nothing selected — the exact bug this file exists for — is not.
  //
  // It has to stay recoverable, which is what the `!selected` half of these two
  // expressions buys: a disabled checkbox on a line that is selected would be a
  // line they can neither submit nor remove.
  assert.match(form, /disabled=\{unavailable && !selected\}/);
  assert.match(form, /if \(!selectedServices\[serviceId\] && unitsLeftForNewLine\(service\) < 1\) return;/);
  // And the form says so rather than just refusing to submit.
  assert.match(form, /<SubmitButton className="w-full" disabled=\{!catalogReady \|\| hasStockShortage\}>/);
  assert.match(form, /\{hasStockShortage \? \(/);
});