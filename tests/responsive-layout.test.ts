import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Word breaking and table layout.
 *
 * `overflow-wrap: anywhere` was applied to every `p`, `li`, `td`, `th`, `label`
 * and `summary` in the app. It was meant to stop a long email or reference from
 * overflowing, but it also participates in how the browser computes the minimum
 * width a box needs — so every table cell reported a min-content width of a
 * single character. The auto layout squeezed each column to fit, and short words
 * started breaking wherever the browser felt like it: "category" rendered as
 * "cate" and "gory", "unavailable" as "unavail" and "able".
 *
 * `break-word` still splits a word that cannot fit on a line by itself, which is
 * the case the rule existed for, but leaves ordinary text to break at spaces
 * and leaves table columns at their real width.
 */

const css = readFileSync("app/globals.css", "utf8");
const table = readFileSync("components/ui/table.tsx", "utf8");
const inventory = readFileSync("app/(admin)/admin/inventory/page.tsx", "utf8");

function wrappedRule(): string {
  const block = css.slice(css.indexOf("p,\nli,\ntd,\nth,"), css.indexOf("a {"));
  return block;
}

test("words break at spaces, not mid-word", () => {
  const rule = wrappedRule();
  assert.match(rule, /overflow-wrap:\s*break-word/, "text must wrap at word boundaries");
  assert.doesNotMatch(rule, /overflow-wrap:\s*anywhere/, "`anywhere` breaks words and collapses table columns");
  assert.doesNotMatch(css, /word-break:\s*break-all/, "nothing may opt back into breaking arbitrary characters");
});

test("an email address never runs out of the box it is in", () => {
  /*
   * The customer list wrote `{customer.user.email}` straight into a
   * `<p className="flex items-center gap-2">`. A bare text node inside a flex
   * container becomes an *anonymous* flex item, and those are `min-width: auto`
   * — they refuse to shrink below their content. An email address has no spaces,
   * so it had nothing to wrap on and ran out through the side of the card.
   *
   * Two things are needed together, and either alone is not enough:
   *  - the value has to be in its own element, or it is an anonymous item again;
   *  - that element needs `min-w-0`, or it still refuses to shrink.
   * The icon needs `shrink-0` for the same reason in reverse, or the letter box is
   * what gets squeezed.
   */
  const screens: Array<[string, string]> = [
    ["app/(admin)/admin/customers/page.tsx", "customer.user.email"],
    ["app/(admin)/admin/bookings/page.tsx", "booking.customer.user.email"],
    ["app/(root)/contact/page.tsx", "settings.email"],
  ];

  for (const [file, expression] of screens) {
    const source = readFileSync(file, "utf8");
    // No email may be a bare child of a flex row again.
    assert.doesNotMatch(
      source,
      new RegExp(`flex[^"]*"[^>]*>\\s*<(?:[A-Za-z]+)\\b[^>]*className="[^"]*shrink-0[^"]*"[^>]*/>\\s*\\{${expression}\\}`),
      `${file} puts {${expression}} straight into a flex row, where it cannot shrink`,
    );
    // Wherever an email is rendered, it is breakable.
    for (const match of source.matchAll(new RegExp(`<(\\w+)[^>]*>\\s*\\{${expression}\\}\\s*</\\1>`, "g"))) {
      assert.match(match[0], /break-(all|words)/, `${file} renders {${expression}} with no break rule: ${match[0].slice(0, 90)}`);
    }
  }

  // The customer card, specifically: a value next to an icon.
  const customers = readFileSync("app/(admin)/admin/customers/page.tsx", "utf8");
  assert.match(customers, /<span className="min-w-0 break-all">\{customer\.user\.email\}<\/span>/, "the email needs its own shrinkable, breakable element");
  assert.match(customers, /Mail className="mt-0\.5 h-4 w-4 shrink-0"/, "the icon must not be what shrinks");
  // The name beside it is just as likely to be a long unbroken string.
  assert.match(customers, /break-words font-semibold/);
});

test("a table cell with an address scrolls sideways rather than escaping", () => {
  // `break-all` inside a cell cannot help if the table is allowed to grow past the
  // viewport, so the cell needs a floor and the table keeps its scroll container.
  const bookings = readFileSync("app/(admin)/admin/bookings/page.tsx", "utf8");
  assert.match(bookings, /min-w-\[220px\] space-y-1/, "the customer cell needs a floor");
  assert.match(bookings, /break-all text-sm text-stone-500/);
  assert.match(bookings, /overflow-x-auto/, "and a container to scroll in");
  // Either its own floor or the shared one; `Table` carries `min-w-[40rem]`, which
  // is what makes the scroll container above mean anything.
  assert.ok(
    /<Table className="min-w-\[/.test(bookings) || /<Table>/.test(bookings),
    "the bookings table must keep a width floor, its own or the shared one",
  );
  assert.match(table, /min-w-\[40rem\]/, "the shared table floor is what the bookings table relies on");
});

test("the sign-in banner does not overflow either", () => {
  assert.match(readFileSync("app/(staff)/staff/pending/page.tsx", "utf8"), /break-all font-semibold/);
});

test("every table has a width floor, so columns scroll instead of squeezing", () => {
  // The `overflow-x-auto` wrapper only helps if the table is actually allowed to
  // be wider than the container.
  assert.match(table, /min-w-\[40rem\]/, "the shared table needs a width floor");
  assert.match(inventory, /<Table className="min-w-\[880px\]">/, "the five-column stock catalog needs a wider floor of its own");
});

test("headers and short values are never wrapped", () => {
  assert.match(table, /whitespace-nowrap/, "table headings are one or two short words and must stay whole");
  // The cells that hold a single token or a short phrase.
  for (const cell of ['className="whitespace-nowrap capitalize"', 'className="whitespace-nowrap">']) {
    assert.ok(inventory.includes(cell), `the stock catalog must keep its short values whole, missing ${cell}`);
  }
});

test("only genuinely long values are allowed to wrap", () => {
  // The item slug is the one unbounded string in a stock row, so it truncates
  // rather than stretching the column or breaking mid-word.
  assert.match(inventory, /className="truncate text-sm text-stone-500"/, "the slug must truncate");
  assert.match(inventory, /min-w-\[240px\]/, "the item cell needs a floor for the thumbnail and name together");
});

test("the dialogs reflow on a phone instead of holding a fixed width", () => {
  const editor = readFileSync("components/admin/inventory-editor.tsx", "utf8");
  // The old popover was a fixed `w-96` two-across grid, which squeezed the two
  // number inputs to unusable widths below `sm`.
  assert.match(editor, /sm:grid-cols-2/, "the quantity pair may go two-across only once there is room");
  assert.match(editor, /max-w-xl/, "the dialog must be bounded and centred rather than a fixed width");
  // Scoped to `className` on purpose: the file explains in a comment why the
  // fixed width was dropped, and matching the prose would fail on its own
  // rationale.
  assert.doesNotMatch(editor, /className="[^"]*\bw-96\b/, "no fixed pixel width");
});
