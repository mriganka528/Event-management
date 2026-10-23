import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * These regressions cover the three customer/staff hand-offs that used to leave
 * people stranded:
 *
 *  - a newly activated staff member had to sign in again with the password they
 *    had just chosen, then wait for a code;
 *  - the booking form stayed editable while the request was in flight, so a
 *    service could be added after the submitted quote had already been built;
 *  - customers received in-app notifications but no email at the moments that
 *    matter: first sign-in, the request itself, approval/decline, and payments.
 */

const read = (path: string) => readFileSync(path, "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing "${start}"`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing "${end}" after "${start}"`);
  return source.slice(from, to);
}

test("activation sends the staff member straight to the code screen", () => {
  const actions = read("lib/auth-actions.ts");
  const activation = between(actions, "export async function activateAccountAction", "/** Sends the enrolment code");

  // The code is issued for the account that just activated, over the address
  // the activation link already proved.
  assert.match(activation, /issueOtp\(\{[\s\S]*?purpose: OtpPurpose\.TWO_FACTOR/);
  assert.match(activation, /channel: OtpChannel\.EMAIL/);
  assert.match(activation, /setPendingTwoFactor\(\{\s*userId: result\.userId,\s*channel: "EMAIL"/);

  // And the action redirects on the server, rather than returning a state that
  // lets the now-used link re-render the activation page before the client can
  // navigate. A server redirect avoids that render entirely.
  assert.match(activation, /redirect\(`\/verify-two-factor\?channel=email&returnTo=/);
  assert.match(activation, /HOME_BY_ROLE\[/);

  // Redeeming the emailed link is what verifies the address. Without this, a
  // later password sign-in is refused as "email not verified".
  const team = read("lib/auth/team.ts");
  const redeem = between(team, "export async function activateWithToken", "/** Completes 2FA enrolment");
  assert.match(redeem, /emailVerifiedAt: new Date\(\)/);
});

test("booking catalog controls freeze while the request is submitted", () => {
  const form = read("components/booking/booking-form.tsx");

  // The third value is the action's pending flag; it is what makes the freeze
  // possible at all.
  assert.match(form, /const \[state, formAction, isSubmitting\] = useActionState\(createBookingAction, initialState\)/);

  // Both the package picker and the service picker are fieldsets, so every
  // radio, checkbox, and stepper inside them is disabled for the duration of
  // the request without any one control being forgotten.
  const fieldsets = form.match(/<fieldset disabled=\{isSubmitting\}/g) ?? [];
  assert.equal(fieldsets.length, 2, "the package and service pickers must both be frozen");

  // The handlers also refuse while pending, in case a synthetic event reaches
  // them before the browser applies the disabled state.
  assert.match(form, /function toggleService\(serviceId: string\) \{\s*\/\/[^]*?\s*if \(isSubmitting\) return;/);
  assert.match(form, /function changeQuantity\(serviceId: string, delta: number\) \{\s*if \(isSubmitting\) return;/);
});

test("the booking request email is sent once, after the transaction commits", () => {
  const bookings = read("lib/bookings.ts");

  // Only a freshly created request notifies the customer. An idempotent replay
  // must not send the same email a second time.
  assert.match(bookings, /createdNow: true/);
  assert.match(bookings, /createdNow: false/);
  assert.match(bookings, /if \(booking\.createdNow\) \{[\s\S]*?await sendBookingRequestEmail\(/);

  // The call sits after the notification hand-off, which only runs once the
  // serializable transaction has committed.
  const committed = bookings.indexOf('emitExistingNotifications(booking.notifications, "/admin/bookings?status=PENDING")');
  const emailed = bookings.indexOf("await sendBookingRequestEmail(", committed);
  assert.ok(committed > 0, "the commit point is missing");
  assert.ok(emailed > committed, "email must not be sent from inside the transaction");
});

test("customer emails are addressed from the Clerk identity and the payment paths", () => {
  const exchange = read("app/api/customer/session/exchange/route.ts");
  // The Clerk profile is the source of the address, and `firstSignIn` covers
  // both a brand-new account and an existing profile that has never signed in.
  assert.match(exchange, /const primary = user\.emailAddresses\.find/);
  assert.match(exchange, /federated\.firstSignIn/);
  assert.match(exchange, /sendCustomerWelcomeEmail\(\{[\s\S]*?to: primary\.emailAddress/);

  const clerk = read("lib/auth/clerk.ts");
  assert.match(clerk, /firstSignIn: !linked\.lastLoginAt/);
  assert.match(clerk, /firstSignIn: !byEmail\.lastLoginAt/);
  assert.match(clerk, /created: true, firstSignIn: true/);

  // Advance requests and every way a payment can land reach the same mailbox.
  assert.match(read("lib/actions.ts"), /await sendPaymentRequestEmail\(/);
  assert.match(read("lib/bookings.ts"), /await sendPaymentReceivedEmail\(/);
  assert.match(read("lib/bookings.ts"), /await sendBookingStatusEmail\(/);
  assert.match(read("lib/cash-payments.ts"), /sendPaymentReceivedEmail\(/);
  assert.match(read("lib/razorpay-payments.ts"), /sendPaymentReceivedEmail\(/);
});

test("the customer mail templates exist and escape their dynamic values", () => {
  const mailer = read("lib/mailer.ts");
  for (const name of ["sendCustomerWelcomeEmail", "sendBookingRequestEmail", "sendPaymentRequestEmail", "sendPaymentReceivedEmail", "sendBookingStatusEmail"]) {
    assert.match(mailer, new RegExp(`export async function ${name}\\(`), `${name} is missing`);
  }
  assert.match(mailer, /function escapeHtml\(value: string\)/);
  // Every customer-facing template runs its names and free text through the
  // escaper rather than interpolating them raw into HTML.
  assert.match(mailer, /const name = firstNameOf\(input\.firstName\)/);
  assert.match(mailer, /escapeHtml\(input\.location\)/);
  assert.match(mailer, /escapeHtml\(input\.packageName\)/);
});
