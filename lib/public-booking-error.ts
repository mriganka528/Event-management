/**
 * Which booking failures are written for the customer, and which are ours.
 *
 * A public booking failure has two audiences. Some errors are written for the
 * person who typed the form — "sign in with the account email and try again",
 * "only 12 chair units are left" — and those must reach them unchanged. Anything
 * else is replaced with a single apologetic sentence so a stack never leaks.
 *
 * That decision lived in a duplicated array of string fragments, once in
 * `publicBookingError` and once in the `/api/bookings` handler, and it went wrong
 * in the worst possible direction: "Sign in with the account email" was missing
 * from the list, so the one piece of guidance that would have unblocked the
 * customer was replaced by
 *
 *   We could not create the booking right now. Please try again.
 *
 * …which is indistinguishable from a broken server, and which is what the
 * customer saw on every attempt after their email had an account. Both call
 * sites now read this list.
 */
const CUSTOMER_FACING_FRAGMENTS = [
  "Event date must",
  "One or more selected services",
  "The selected package",
  "Choose a package",
  "Please enter",
  "valid date",
  "valid event date",
  "valid end date",
  "guest",
  "location",
  "incoming",
  "is fully booked for the dates",
  "left but this request needs",
  "Choose a package or service",
  // The date range the customer picked. Both halves are things they typed, so
  // both are worth telling them about: the end date before the start is a
  // mistake they can fix, and so is a range longer than the business allows.
  "end date must be on or after",
  "cannot run for more than",
  // An address that already belongs to an account cannot be re-pointed, and the
  // requester has to arrive signed in to join it. Only ever reached by an
  // authenticated team member, so naming the account's role discloses nothing.
  "Sign in with the account email",
  "reserved for an administrator account",
  // The signed-in sibling: the session itself is not a customer. Also written for
  // the person reading it.
  "reserved for administrators",
  // Written for the customer, who genuinely has to talk to us about it.
  "quote is too large",
  // The one refusal every anonymous request gets, whatever address it carries.
  "Sign in or create a customer account",
];

/**
 * The message to show the customer, or `null` when the failure is ours and the
 * friendly sentence should stand in for it.
 */
export function customerFacingBookingMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message.toLowerCase();
  return CUSTOMER_FACING_FRAGMENTS.some((fragment) => message.includes(fragment.toLowerCase())) ? error.message : null;
}

/** Exported for the tests that pin the list against the messages actually thrown. */
export const CUSTOMER_FACING_BOOKING_FRAGMENTS = CUSTOMER_FACING_FRAGMENTS;

/**
 * The refusal every anonymous booking request gets.
 *
 * Worth its own predicate because it is the answer a form has to act on rather
 * than print: it is not an error to be explained, it is the step before a booking
 * exists. The catalog is public, so the customer reaches the form and fills it in
 * first, and only the submission needs an account — so the form turns this into
 * both ways forward, signing in for somebody who already has one and creating one
 * for somebody who does not.
 *
 * The wording deliberately never mentions the address that was submitted. The
 * same sentence comes back for an unknown address, one belonging to a customer,
 * and one belonging to an administrator, which is the only version of this that is
 * safe: the alternative is a form that answers "who is an administrator here" for
 * anyone willing to type addresses into it.
 */
export function isAccountRequiredBookingError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("sign in or create a customer account");
}
