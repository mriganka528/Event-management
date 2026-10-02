/**
 * Auth cookie names.
 *
 * `__Host-` is a security prefix: it makes the cookie host-only, pins it to
 * `Path=/`, and — the part that bites in development — browsers only accept it
 * when the `Secure` attribute is *also* present. `Secure` is in turn only
 * honoured on a trustworthy origin, so over the plain `http://localhost:3000`
 * that the README documents for local development the prefix cannot be
 * satisfied and the browser silently discards the cookie. Nothing fails
 * loudly; the sign-in flow simply cannot remember the user.
 *
 * The prefixed name is therefore used only when the request actually arrived
 * over HTTPS. In production the behaviour is byte-for-byte unchanged; locally
 * the same cookies are written under an unprefixed name.
 *
 * The edge proxy and the server derive the name from the same two inputs
 * (`x-forwarded-proto` and `NODE_ENV`), so they always agree on which name a
 * given request is using. Keep this module free of `server-only` and of
 * `next/headers` so `proxy.ts` can import it.
 */

export const HOST_PREFIXED_SESSION_COOKIE = "__Host-event_session";
export const HOST_PREFIXED_PENDING_2FA_COOKIE = "__Host-event_2fa_pending";

/** Used only when the request is not over HTTPS, i.e. local development. */
export const PLAIN_SESSION_COOKIE = "event_session";
export const PLAIN_PENDING_2FA_COOKIE = "event_2fa_pending";

/**
 * Read-only companion cookie so the client can correlate a device. It carries
 * no authority of its own, so it never needed the prefix and never gets it.
 */
export const DEVICE_COOKIE = "event_device";

/**
 * Whether the current request can carry a `Secure` cookie.
 *
 * The forwarded protocol wins when present because behind a TLS-terminating
 * proxy the internal hop is plain http. When the header is absent there is no
 * proxy in the path, so the deployment mode decides: production is expected to
 * be HTTPS.
 */
export function isHttps(forwardedProto: string | null | undefined, production: boolean): boolean {
  const proto = forwardedProto?.split(",")[0]?.trim();
  return proto ? proto === "https" : production;
}

export function sessionCookieName(https: boolean): string {
  return https ? HOST_PREFIXED_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}

export function pendingTwoFactorCookieName(https: boolean): string {
  return https ? HOST_PREFIXED_PENDING_2FA_COOKIE : PLAIN_PENDING_2FA_COOKIE;
}
