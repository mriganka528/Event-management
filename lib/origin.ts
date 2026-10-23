/**
 * Origin checks for state-changing requests (CSRF defence in depth).
 *
 * The browser's `Origin` header cannot be forged by a web page, so comparing it
 * with the origin the request actually arrived on is enough to reject a
 * cross-site form post. The subtle part is working out that arrived-on origin,
 * because `request.url` is not always it:
 *
 *  - A Node custom server binds `0.0.0.0`, so Next builds URLs such as
 *    `http://0.0.0.0:3000/...` while the browser sends `http://localhost:3000`.
 *  - A reverse proxy terminates TLS and rewrites the host, so the public origin
 *    lives in `x-forwarded-host` / `x-forwarded-proto`.
 *
 * `Host` and `x-forwarded-*` are safe to consult here. A cross-site page cannot
 * choose the `Host` of a request sent to this application, and a DNS-rebinding
 * page that could would still not carry our session cookie, which is scoped to
 * our own domain.
 *
 * Split into its own module because the Edge middleware and the Node route
 * handlers must answer this question identically.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function normaliseHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function toOrigin(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The canonical public origin, used for redirects and for allowing requests
 * that arrive through a proxy whose own URL is not public. */
export function configuredSiteOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL;
  return toOrigin(value)?.origin ?? null;
}

export function isSameOrigin(request: Request): boolean {
  const header = request.headers.get("origin");
  // Non-browser clients (curl, server-to-server) omit Origin. Rejecting them in
  // production keeps the API browser-only; local scripts keep working.
  if (!header) return process.env.NODE_ENV !== "production";

  const claimed = toOrigin(header);
  if (!claimed) return false;

  const candidates: URL[] = [];
  const add = (value: string | null | undefined) => {
    const url = toOrigin(value);
    if (url) candidates.push(url);
  };

  // `request.url` covers direct requests and Vercel; the configured origin
  // covers canonical-domain redirects; the forwarded/host headers cover a
  // custom server or a reverse proxy in front of it.
  add(request.url);
  add(configuredSiteOrigin());

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host"));
  if (host) {
    const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
    const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : claimed.protocol.slice(0, -1);
    add(`${protocol}://${host}`);
  }

  if (candidates.some((candidate) => candidate.origin === claimed.origin)) return true;

  // `0.0.0.0` is a bind address, never an origin a browser sends. Treat the
  // loopback names as equivalent when the port matches, so local development
  // works whether the app was opened at localhost, 127.0.0.1, or the LAN IP
  // that the custom server advertises.
  if (LOOPBACK_HOSTS.has(normaliseHostname(claimed.hostname))) {
    const claimedPort = claimed.port || defaultPort(claimed.protocol);
    return candidates.some((candidate) => {
      if (candidate.protocol !== claimed.protocol) return false;
      if (!LOOPBACK_HOSTS.has(normaliseHostname(candidate.hostname))) return false;
      return (candidate.port || defaultPort(candidate.protocol)) === claimedPort;
    });
  }

  return false;
}
