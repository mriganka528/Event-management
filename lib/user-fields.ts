/**
 * The user fields that travel with a booking.
 *
 * `include: { user: true }` pulls every scalar on the row, and the password
 * hash is one of them. It is a credential — a scrypt hash of the password, and
 * anybody who holds it can check guesses against it offline — so it belongs in
 * exactly one place, the sign-in comparison, and nowhere else.
 *
 * The risk was that it travelled. The result of a booking query carries the
 * customer, that result reaches a Server Component, and a Server Component's
 * props are serialised to the browser for the client half of the tree. Nothing
 * has actually been sent, because the components read named fields rather than
 * spreading the object, but that is a property of the code that happens to be
 * there today rather than something the query layer enforces.
 *
 * Naming the fields makes the accident impossible: a query that adds
 * `passwordHash` to this list is visible in a diff, and the one query that
 * genuinely needs the hash selects it on its own.
 */
export const CUSTOMER_USER_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
} as const;

/** The same fields for a staff member, whose workspace shows the same things. */
export const STAFF_USER_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
} as const;
