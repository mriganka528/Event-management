/**
 * Why a customer could not be handed a local session, and what to say about it.
 *
 * `/customer/auth/complete` exists only to explain a refusal, and it is reached
 * from the exchange endpoint by redirect — see
 * `app/api/customer/session/exchange/route.ts`. A redirect carries a code in the
 * query string, never a message: a message would be request-controlled text
 * rendered straight back into the page. The code is looked up in this fixed
 * table instead, and an unrecognised one renders no message at all.
 *
 * Both sides of the redirect import this, so the code that is written is by
 * construction a code that can be read back.
 */

export type ExchangeRefusal =
  /** The address is already claimed by another local identity. */
  | "EMAIL_TAKEN"
  /** A staff account, a blocked account, or an identity linked elsewhere. */
  | "ACCOUNT_BLOCKED"
  /** The provider supplied no usable email address. */
  | "INVALID_EMAIL"
  /** The account already holds the maximum number of active devices. */
  | "DEVICE_LIMIT_REACHED"
  /** The provider session was gone by the time the exchange ran. */
  | "NOT_SIGNED_IN";

const MESSAGES: Record<ExchangeRefusal, string> = {
  EMAIL_TAKEN: "That email address is already linked to another account.",
  ACCOUNT_BLOCKED: "That email address belongs to a staff account. Sign in with your password instead.",
  INVALID_EMAIL: "That account has no usable email address.",
  DEVICE_LIMIT_REACHED: "You are signed in on the maximum number of devices. Sign one out before using another.",
  NOT_SIGNED_IN: "Your sign-in session expired. Please sign in again.",
};

/**
 * The message for a refusal code, or null when the code is absent or not one of
 * ours. Never echoes the input.
 */
export function exchangeRefusalMessage(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code as ExchangeRefusal] : null;
}

/** The query parameter the refusal code travels in. */
export const EXCHANGE_REFUSAL_PARAM = "error";

/**
 * Where the exchange sends a refusal. Kept next to the parameter so the two
 * halves of the redirect cannot drift apart, and so the completion page can
 * assert against the same constant the endpoint writes.
 */
export const CUSTOMER_COMPLETE_PATH = "/customer/auth/complete";

/** The refusal redirect for a code, as a same-origin path. */
export function customerExchangeRefusal(code: ExchangeRefusal): string {
  return `${CUSTOMER_COMPLETE_PATH}?${EXCHANGE_REFUSAL_PARAM}=${encodeURIComponent(code)}`;
}