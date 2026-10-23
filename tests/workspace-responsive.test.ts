import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The customer and staff workspaces on a phone.
 *
 * Both dashboards were laid out for a wide screen and squeezed into a narrow
 * one. The failures were all the same shape:
 *
 *  - the heading was set at a fixed 4xl, so a long first name or a long
 *    heading ran past the edge of the screen;
 *  - a currency figure was truncated, so ₹1,00,300 was read as "₹1,00,3…";
 *  - a venue address was a bare flex child, so it could not shrink and
 *    pushed the row wider than the card;
 *  - the top bar wrapped at an arbitrary point, so its height depended on how
 *    long the business name happened to be.
 *
 * None of that is visible in a type check. It only shows up on a 320px
 * screen, so the rules are pinned here.
 */

const customerDashboard = readFileSync("app/(customer)/customer/dashboard/page.tsx", "utf8");
const customerBooking = readFileSync("app/(customer)/customer/bookings/[id]/page.tsx", "utf8");
const customerLayout = readFileSync("app/(customer)/customer/layout.tsx", "utf8");
const customerTrack = readFileSync("app/(customer)/customer/track/page.tsx", "utf8");
const customerAccess = readFileSync("app/(customer)/customer/access/page.tsx", "utf8");
const customerNewBooking = readFileSync("app/(customer)/customer/bookings/new/page.tsx", "utf8");
const staffDashboard = readFileSync("app/(staff)/staff/page.tsx", "utf8");
const staffLayout = readFileSync("app/(staff)/staff/layout.tsx", "utf8");
const header = readFileSync("components/layout/workspace-header.tsx", "utf8");
const accountMenu = readFileSync("components/auth/account-menu.tsx", "utf8");
const logo = readFileSync("components/layout/business-logo.tsx", "utf8");

test("a heading never runs past the edge of a phone screen", () => {
  // `text-4xl` is 36px. A 320px screen fits about 24 characters at that size,
  // and "Your event day, simplified." is 27.
  const screens: Array<[string, string]> = [
    ["customer dashboard", customerDashboard],
    ["customer booking", customerBooking],
    ["customer track", customerTrack],
    ["customer access", customerAccess],
    ["customer new booking", customerNewBooking],
    ["staff dashboard", staffDashboard],
  ];
  for (const [file, source] of screens) {
    const headings = [...source.matchAll(/<h1[^>]*className="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(headings.length > 0, `${file} has no heading to check`);
    for (const heading of headings) {
      assert.match(heading, /\btext-3xl\b/, `${file}: the heading must step down below \`sm\``);
      // A heading that starts above 3xl overflows before the breakpoint that
      // would have stepped it down.
      assert.doesNotMatch(heading, /className="[^"]*\btext-4xl\b/, `${file}: the heading must not start at 4xl`);
    }
  }
});

test("a money figure is never truncated", () => {
  /*
   * `truncate` on a currency value quietly changes the number the customer
   * is supposed to read. It was there to keep the four summary cards the
   * same height, and it cost them the last digit of the balance.
   */
  assert.doesNotMatch(customerDashboard, /truncate text-2xl font-semibold/, "the summary cards must not truncate a currency figure");
  assert.match(customerDashboard, /break-words text-2xl font-semibold/, "the summary cards must wrap instead");
});

test("a venue address can break rather than widen its row", () => {
  // An address is free text. As a bare flex child it refused to shrink and
  // pushed the whole row past the edge of the card.
  for (const [file, source] of [
    ["customer dashboard", customerDashboard],
    ["customer booking", customerBooking],
    ["customer track", customerTrack],
    ["staff dashboard", staffDashboard],
  ] as const) {
    assert.match(source, /min-w-0 break-words/, `${file}: a location must be allowed to break`);
  }
});

test("the workspace bar never wraps", () => {
  // The bar used to be a wrapping flex row, so its height changed with the
  // length of the business name.
  assert.match(header, /flex items-center justify-between/, "the bar must be one row");
  assert.doesNotMatch(header, /flex-wrap/, "the bar must not wrap");
  // The brand is the one part that has to give way when the name is long.
  assert.match(header, /min-w-0 flex-1/, "the brand must be able to shrink");
  assert.match(header, /shrink-0/, "the controls must not be squeezed");
});

test("the account control moves behind a disclosure on a phone", () => {
  /*
   * The account chip, the sign-out button, and the theme switch together
   * were wider than a phone. They are now behind a labelled toggle below
   * `sm`, with the toggle named for a screen reader.
   */
  assert.match(header, /aria-expanded=\{open\}/, "the toggle must say whether it is open");
  assert.match(header, /aria-controls="workspace-menu"/, "the toggle must point at the panel it opens");
  assert.match(header, /Open menu/, "the toggle must be named");
  assert.match(header, /id="workspace-menu"/, "the panel must exist to be pointed at");
  assert.match(header, /hidden sm:block/, "the account control is in the bar from `sm` up");
  assert.match(header, /sm:hidden/, "and behind the disclosure below it");
  assert.match(header, /Escape/, "the disclosure must close on Escape");
});

test("the account control is a real popover on wider screens", () => {
  /*
   * The old chip put the avatar, the name, and a sign-out button directly in
   * the bar. That worked on a laptop but left no room for the account links a
   * customer or staff member needs, and it had no keyboard story at all.
   */
  assert.match(accountMenu, /aria-haspopup="dialog"/, "the account trigger must announce what it opens");
  assert.match(accountMenu, /aria-expanded=\{open\}/, "the trigger must say whether the popover is open");
  assert.match(accountMenu, /aria-controls=\{panelId\}/, "the trigger must point at the popover");
  assert.match(accountMenu, /role="dialog"/, "the popover needs a role and a name");
  assert.match(accountMenu, /addEventListener\("pointerdown"/, "a click outside must close the popover");
  assert.match(accountMenu, /event\.key !== "Escape"/, "Escape must close the popover");
});

test("the phone disclosure scrolls instead of running off a short screen", () => {
  assert.match(header, /overflow-y-auto/, "the panel needs its own scroll container");
  assert.match(header, /max-h-\[min\(34rem,calc\(100dvh-5\.5rem\)\)\]/, "and a height bounded by the viewport");
  // The backdrop is for catching outside clicks, not for painting a band over
  // the floating bar or the page. It must stay transparent, like the public
  // header's mobile menu.
  assert.match(header, /bg-transparent/, "the click-catching backdrop must be transparent");
  assert.doesNotMatch(header, /bg-stone-950/, "opening the menu must not tint the page");
  assert.doesNotMatch(header, /backdrop-blur/, "and it must not blur the page either");
  assert.match(header, /aria-modal="true"/, "the panel is the only thing to interact with while open");
});

test("the workspace bars float like the public header", () => {
  // A full-width strip pinned to the top read as admin chrome. The public site
  // already had a floating glass pill; the customer and staff areas use the
  // same shape so moving between the marketing site and a workspace feels like
  // the same product.
  for (const [file, source] of [
    ["customer layout", customerLayout],
    ["staff layout", staffLayout],
  ] as const) {
    assert.match(source, /className="container-shell sticky top-3 z-40 pt-3 sm:top-4 sm:pt-4"/, `${file} must use the floating sticky shell`);
    assert.match(source, /glass-panel/, `${file} must use the shared glass surface`);
    assert.match(source, /rounded-3xl[^"]*sm:rounded-full/, `${file} must be a rounded bar`);
  }
});

test("both workspaces use the same bar", () => {
  // Two bars means two sets of bugs. The customer and the staff workspace
  // have the same shape, so they have the same component.
  for (const [file, source] of [
    ["customer layout", customerLayout],
    ["staff layout", staffLayout],
  ] as const) {
    assert.match(source, /<WorkspaceHeader\b/, `${file} must use the shared bar`);
  }
});

test("the business logo is in both workspace bars", () => {
  for (const [file, source] of [
    ["customer layout", customerLayout],
    ["staff layout", staffLayout],
  ] as const) {
    assert.match(source, /<BusinessLogo[\s\S]{0,200}logoUrl=/, `${file} must render the uploaded logo`);
  }
  // A pale upload on a pale card is invisible without a surface of its own.
  assert.match(logo, /bg-white/, "the logo needs a surface of its own");
  assert.match(logo, /border/, "and a border");
  // The name is still there, so a business without artwork is not left with a
  // gap where the logo would have been.
  assert.match(customerLayout, /\{businessName\}/);
  assert.match(staffLayout, /\{businessName\}/);
});

test("a wide button in a dashboard is allowed to be full width on a phone", () => {
  /*
   * A button that is not full width on a phone is a small target for a thumb.
   * The three that matter are the ones a customer actually presses.
   */
  assert.match(customerDashboard, /className="w-full shrink-0 sm:w-auto"/, "the header action must fill a narrow screen");
  assert.match(customerDashboard, /<Button className="w-full sm:w-auto">/, "and so must its button");
  assert.match(staffDashboard, /className="w-full shrink-0 sm:w-auto"/, "the availability toggle must fill a narrow screen");
});

test("a card header stacks its title and its badge on a phone", () => {
  // A title and a badge side by side in a narrow card left the title with
  // almost no room, and the title is the thing the reader came for.
  assert.match(customerDashboard, /flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between/, "a card header must stack on a phone");
  // The booking detail puts its title and its status badge in a plain row
  // rather than a card header, and that row stacks for the same reason.
  assert.match(customerBooking, /flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between/, "the booking title and its badge must stack on a phone");
  assert.match(customerBooking, /Badge className=\{`shrink-0 /, "and the badge must not be squeezed");
});
