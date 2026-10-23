import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirects that address the visitor's own origin, not the server's.
 *
 * `NextResponse.redirect(new URL(path, request.url))` looks right and is wrong
 * often enough to matter. `request.url` is assembled by Next.js from the
 * *process's* idea of itself, not from the `Host` the visitor used, so behind the
 * custom server in `server.mjs` — which binds `0.0.0.0` — a request to
 * `http://localhost:3000` reports a base of `http://0.0.0.0:3000`, and a
 * redirect built from it sends the browser to an address that only works by
 * accident. The `Host` header is the only thing that is correct by construction,
 * and it is the same signal `isSameOrigin` in `proxy.ts` already trusts.
 */

/**
 * The origin the visitor actually asked for.
 *
 * `x-forwarded-proto` wins where present, because a TLS-terminating proxy makes
 * the internal hop plain http; the same rule as `isHttps` in
 * `lib/auth/cookie-names.ts`. Falls back to the URL Next.js built only when there
 * is no `Host` header at all, which does not happen for a real request.
 */
export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/**
 * An absolute redirect, for the edge.
 *
 * Next.js validates the `Location` it receives back from middleware and rejects
 * a relative one with `ERR_INVALID_URL`, so this cannot stay relative the way
 * {@link relativeRedirectTo} is. That is also why the origin has to be derived
 * from the request rather than from a configured site URL: `NEXT_PUBLIC_SITE_URL`
 * is optional, and is unset in most local setups, so relying on it would send
 * local redirects to the wrong port.
 */
export function redirectTo(path: string, request: NextRequest, status: 307 | 303 | 308 = 307): NextResponse {
  return NextResponse.redirect(new URL(path, requestOrigin(request)), status);
}

/**
 * A same-origin redirect whose target is kept relative.
 *
 * Route handlers are not subject to the validation above, and keeping the target
 * relative is strictly better where it is allowed: the browser resolves it
 * against the URL it just requested, so the canonical host, a local development
 * origin, and a TLS-terminating proxy all keep working with no configuration.
 * RFC 9110 §10.2.2 permits a relative reference in `Location`.
 */
export function relativeRedirectTo(path: string, status: 307 | 303 | 308 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}