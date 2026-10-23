import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { CUSTOMER_FACING_BOOKING_FRAGMENTS, customerFacingBookingMessage, isAccountRequiredBookingError } from "@/lib/public-booking-error";

/**
 * Which booking failures the customer is allowed to read.
 *
 * This list is a wall between the internal detail of a failure and the person who
 * triggered it, and it is built by matching fragments of the message. That makes
 * it fragile in a way no other allowlist here is: nothing fails when a fragment
 * goes missing — the message is simply *replaced*, so a customer who needed to be
 * told something actionable is told nothing at all.
 *
 * That is not hypothetical. "Sign in with the account email and try again" was
 * missing, so anyone whose email already owned an account — which is everyone
 * after their first booking, or their first sign-up — was shown
 *
 *   We could not create the booking right now. Please try again.
 *
 * for every attempt, with no way to tell a server problem from a rule about their
 * own address. So the list is pinned here against the strings the code actually
 * throws.
 */

const bookingsSource = readFileSync("lib/bookings.ts", "utf8");
const inventorySource = readFileSync("lib/inventory.ts", "utf8");

/**
 * Every message the *public* booking path throws.
 *
 * Scoped to `createBookingForPublicCustomer` and the helper it delegates customer
 * lookup to. `lib/bookings.ts` also holds the admin writes — approving a booking,
 * issuing an invoice, recording a payment — and their messages are written for an
 * operator at a keyboard with the booking open in front of them. None of them
 * travel through `publicBookingError`, so classifying them here would be noise.
 */
function thrownMessages(): string[] {
  /** The body of a top-level `function`, up to its closing brace at column 0. */
  const bodyOf = (source: string, name: string) => {
    const start = source.search(new RegExp(`(export )?(async )?function ${name}\\b`));
    assert.ok(start > 0, `${name} is missing, so the scan is broken`);
    const end = source.indexOf("\n}\n", start);
    return source.slice(start, end === -1 ? undefined : end);
  };

  const bodies = [
    bodyOf(bookingsSource, "createBookingForPublicCustomer"),
    // Reached only from the booking path, and the source of the "sign in with the
    // account email" refusal — which is why it has to be scanned here too.
    bodyOf(bookingsSource, "getOrCreatePublicCustomer"),
  ];

  const messages = [
    ...bodies.flatMap((body) => [...body.matchAll(/throw new Error\(\s*"([^"]{6,})"/g)].map((match) => match[1])),
    // Template messages are read by their fixed part.
    ...bodies.flatMap((body) => [...body.matchAll(/throw new Error\(\s*`([^`$]{6,})/g)].map((match) => match[1])),
    // The capacity shortfall wording is returned, not thrown, but it is the one
    // message a customer most needs to read in full.
    ...[...inventorySource.matchAll(/return `([^`]{20,})`/g)].map((match) => match[1]),
  ];
  return messages.map((message) => message.replace(/\\"/g, '"').trim());
}

test("a customer-facing message reaches the customer unchanged", () => {
  const written = "This booking request could not be created. Sign in with the account email and try again.";
  assert.equal(customerFacingBookingMessage(new Error(written)), written);
  // Case-insensitively, because the fragments are matched that way.
  assert.equal(customerFacingBookingMessage(new Error("SIGN IN WITH THE ACCOUNT EMAIL, PLEASE.")), "SIGN IN WITH THE ACCOUNT EMAIL, PLEASE.");
});

test("an internal failure is never forwarded", () => {
  for (const failure of ["Unique constraint failed on the fields: (`email`)", "Transaction failed due to a write conflict", "connect ECONNREFUSED 10.0.0.4:5432", ""]) {
    assert.equal(customerFacingBookingMessage(new Error(failure)), null, `"${failure}" must not reach a customer`);
  }
  // A thrown non-Error is an internal failure too.
  assert.equal(customerFacingBookingMessage("Sign in with the account email"), null);
  assert.equal(customerFacingBookingMessage(null), null);
});

/**
 * Messages the public booking path throws that are deliberately *not* shown.
 *
 * Each one is a decision, not an oversight: the customer is told the request could
 * not be created and the cause is logged. A customer cannot act on an idempotency
 * key, and a sentence mentioning one would only invite them to photograph it.
 */
const DELIBERATELY_INTERNAL = [
  // A customer never reuses a key, so this only ever fires when something else
  // has gone wrong — which is exactly when a specific sentence would mislead.
  "That idempotency key was already used for a different booking request.",
  // The customer profile is created with the account, so this is a type guard
  // rather than a rule. There is nothing a customer could do about it, and a
  // sentence asking them to try again would be untrue.
  "This account cannot take a booking request.",
];

test("every message the booking path throws is classified on purpose", () => {
  // The check that would have caught the original bug: a message nobody
  // classified is indistinguishable, to the customer, from a server that broke.
  const unclassified = thrownMessages().filter(
    (message) => customerFacingBookingMessage(new Error(message)) === null && !DELIBERATELY_INTERNAL.includes(message),
  );
  assert.deepEqual(
    unclassified,
    [],
    `these are shown to the customer as "we could not create the booking right now". Either write them for the customer and add them to CUSTOMER_FACING_BOOKING_FRAGMENTS, or list them in DELIBERATELY_INTERNAL as a deliberate choice:\n  ${unclassified.join("\n  ")}`,
  );
});

test("the internal list is not a place to hide a customer message", () => {
  // Every entry has to still be thrown, or it is a stale excuse for a message that
  // no longer exists.
  const thrown = thrownMessages();
  for (const message of DELIBERATELY_INTERNAL) {
    assert.ok(thrown.includes(message), `"${message}" is no longer thrown; remove it from DELIBERATELY_INTERNAL`);
    // And nothing phrased for a person may end up here.
    assert.doesNotMatch(message, /please|try again|sign in/i, `"${message}" reads like advice to a person — classify it instead`);
  }
});

test("the guidance that unblocks someone is still classified", () => {
  // Guards against the reverse failure: someone tidying the list and dropping a
  // fragment because "it is only mentioned once".
  const messages = thrownMessages();

  // Thrown by the write path, so each must both still be thrown and reach the
  // customer.
  const thrownByTheWrite = [
    "This booking request could not be created. Sign in with the account email and try again.",
    "This email is reserved for an administrator account.",
    "This account is reserved for administrators.",
    "Sign in or create a customer account to send this booking request.",
    "One or more selected services are no longer available.",
    "The selected package is no longer available.",
  ];
  for (const message of thrownByTheWrite) {
    assert.ok(messages.some((thrown) => thrown.startsWith(message.slice(0, 40))), `"${message}" is no longer thrown, so this expectation needs revisiting`);
    assert.ok(customerFacingBookingMessage(new Error(message)), `"${message}" must reach the customer`);
  }

  // Raised by the schema rather than thrown: they are a `ZodError`, which
  // `publicBookingError` answers separately. They still have to classify, in case
  // one is ever re-thrown as a plain Error.
  for (const message of ["Choose a package or at least one service.", "Event date must be today or later."]) {
    assert.ok(customerFacingBookingMessage(new Error(message)), `"${message}" must classify`);
  }
});

test("only the account-required refusal is flagged as actionable", () => {
  // It is the one failure with somewhere to go, and the form turns it into the
  // two ways forward. Flagging anything else would send a customer to a login for
  // a problem signing in cannot fix.
  assert.equal(isAccountRequiredBookingError(new Error("Sign in or create a customer account to send this booking request.")), true);
  for (const message of [
    "This email is reserved for an administrator account.",
    "Only 12 chair units are left but this request needs 40.",
    "Unique constraint failed on the fields: (`email`)",
    "Please enter the event location.",
  ]) {
    assert.equal(isAccountRequiredBookingError(new Error(message)), false, `"${message}" has no sign-in to offer`);
  }
  assert.equal(isAccountRequiredBookingError(null), false);
});

test("the booking form offers both ways forward", () => {
  // Signing in and creating an account are both offered because the visitor cannot
  // be told which applies — asking them is the same question the form must not
  // answer.
  const form = readFileSync("components/booking/booking-form.tsx", "utf8");
  assert.match(form, /state\.code === "ACCOUNT_REQUIRED"/, "the form must act on the code, not only print the message");
  assert.match(form, /href="\/customer\/auth\/sign-in"/);
  assert.match(form, /href="\/customer\/auth\/sign-up"/);
  // `/sign-in` is the staff password form and cannot sign a customer in.
  assert.doesNotMatch(form, /href="\/sign-in"/);

  // And the code has to survive the trip from the action to the form.
  const actions = readFileSync("lib/actions.ts", "utf8");
  assert.match(actions, /code: isAccountRequiredBookingError\(error\) \? "ACCOUNT_REQUIRED" : undefined/);
});

test("an anonymous request is refused before the address is read", () => {
  /*
   * The disclosure this closes: the form used to answer differently depending on
   * the address typed into it — unknown address booked, an address with an account
   * was told to sign in, and a team address was told it belonged to an
   * administrator. That made it an oracle for "who is an administrator here",
   * answerable by anyone with a list of addresses.
   *
   * Ordering is the whole fix: check the session first and the answer cannot
   * depend on the address, because the address is never looked at. A guard placed
   * after the lookup would still disclose through its wording, and through
   * response time.
   */
  const source = readFileSync("lib/bookings.ts", "utf8");
  const guard = source.indexOf("Sign in or create a customer account to send this booking request.");
  assert.ok(guard > 0, "the anonymous refusal is missing");

  const body = source.slice(source.indexOf("export async function createBookingForPublicCustomer"), source.indexOf("async function", source.indexOf("export async function createBookingForPublicCustomer") + 10));
  const refusal = body.indexOf("Sign in or create a customer account");
  const lookup = body.indexOf("getOrCreatePublicCustomer(");
  assert.ok(refusal > 0 && lookup > refusal, `the refusal must come before the address is resolved (refusal at ${refusal}, lookup at ${lookup})`);
  assert.match(body, /const session = await getCurrentUser\(\);\s*if \(!session\)/, "the session is the gate");

  // The refusal must not describe the address it was given, in any form.
  const message = /throw new Error\("Sign in or create a customer account[^"]*"\)/.exec(source)?.[0] ?? "";
  assert.doesNotMatch(message, /admin|administrator|staff|team|account exists|already|registered/i, "the refusal must not describe what the address turned out to be");
});

test("the copy no longer promises a booking without an account", () => {
  // The behaviour and the words have to agree, or the site is lying about what it
  // will do. The catalog is genuinely open; only the request needs an account.
  const files = [
    "components/booking/booking-form.tsx",
    "app/(customer)/customer/bookings/new/page.tsx",
    "app/(root)/page.tsx",
    "app/(auth)/auth-choice/page.tsx",
  ];
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /without (creating )?an account|No account is required/i, `${file} still promises an account-free booking`);
  }
});

test("the catalog is still readable without an account", () => {
  // Only the *request* is gated. Refusing to publish the catalog would fix the
  // disclosure by fixing nothing and losing the sales pitch.
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /\/customer\/bookings\/new/, "the booking form stays reachable without a session");
  assert.doesNotMatch(proxy, /pathname === "\/customer\/bookings\/new"/, "the form is public by omission, not by an explicit rule");
  // And the public catalog endpoints are untouched.
  const api = readFileSync("app/api/bookings/route.ts", "utf8");
  assert.match(api, /export async function GET/, "the catalog is served without a session");
});


test("the page and the API classify a failure the same way", () => {
  // Two copies of the list is how the fragment went missing from one of them in
  // the first place: both read one list now.
  for (const file of ["lib/actions.ts", "app/api/bookings/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /customerFacingBookingMessage\(error\)/, `${file} must classify through the shared list`);
    assert.doesNotMatch(source, /left but this request needs/, `${file} must not carry its own copy of the fragment list`);
  }
});

test("an internal failure is logged, so it can be diagnosed at all", () => {
  // The customer-facing sentence replaced the cause entirely, which is why this
  // took a reproduction to find: nothing anywhere recorded what went wrong.
  for (const file of ["lib/actions.ts", "app/api/bookings/route.ts"]) {
    assert.match(readFileSync(file, "utf8"), /console\.error\("\[booking\]/, `${file} must log the failure it replaces`);
  }
});

test("the fragment list has no near-duplicates", () => {
  const fragments = CUSTOMER_FACING_BOOKING_FRAGMENTS;
  assert.equal(fragments.length, new Set(fragments).size);
  // "guest" and "location" are short on purpose: they match the two validation
  // sentences that would otherwise read as internal. Every other fragment has to
  // be specific enough that it cannot catch an unrelated failure.
  const allowedShort = new Set(["guest", "location"]);
  for (const fragment of fragments) {
    if (allowedShort.has(fragment)) continue;
    assert.ok(fragment.length >= 8, `"${fragment}" is too short to classify anything safely`);
  }
});
