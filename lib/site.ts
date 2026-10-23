import "server-only";

const fallbackSiteUrl = "http://localhost:3000";

/**
 * Read an environment variable without letting Next.js freeze it at build time.
 *
 * `NEXT_PUBLIC_*` values are normally inlined into the bundle by the compiler.
 * For a public origin that is undesirable: setting or correcting the value in
 * the hosting dashboard should affect the next request, not require a rebuild
 * to un-bake the old one. This module is only imported by server code.
 */
function readEnv(name: string) {
  return process.env[name];
}

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Parse one configured origin.
 *
 * Environment variables are often copied without a scheme (`my-site.vercel.app`)
 * or with quotes around the value. Both used to fall through to localhost,
 * which is how production emails ended up pointing at a developer machine.
 */
function parseSiteUrl(value: string | undefined): URL | null {
  const raw = value ? stripQuotes(value.trim()) : "";
  if (!raw) return null;

  // A bare host gets a scheme rather than being rejected. `new URL("localhost:3000")`
  // otherwise treats `localhost:` as the scheme and throws.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `${/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(raw) ? "http" : "https"}://${raw}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Only the origin belongs in canonical URLs. A trailing path or slash in
    // the environment variable must not leak into the sitemap or metadata.
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function isLoopback(url: URL) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
}

/**
 * The canonical public origin.
 *
 * `NEXT_PUBLIC_SITE_URL` is the explicit setting in the Vercel project. The
 * server-only `SITE_URL`/`APP_URL` names and Vercel's system variables are
 * fallbacks, so a missing public variable does not turn production email links
 * into `http://localhost:3000`. That fallback is reserved for local
 * development, where there is no deployment URL to use.
 *
 * Vercel system variables are only present when "Enable access to System
 * Environment Variables" is switched on. They are an extra safety net, not a
 * requirement.
 */
export function getSiteUrl() {
  const candidates = [
    readEnv("NEXT_PUBLIC_SITE_URL"),
    readEnv("SITE_URL"),
    readEnv("APP_URL")?.split(",")[0],
    readEnv("VERCEL_PROJECT_PRODUCTION_URL"),
    readEnv("VERCEL_URL"),
  ];

  const parsed = candidates.map(parseSiteUrl).filter((url): url is URL => url !== null);

  if (process.env.NODE_ENV === "production") {
    // A localhost value in a deployed environment is a misconfiguration. Prefer
    // the deployment URL when one is available; never let it win over a real
    // production origin.
    return parsed.find((url) => !isLoopback(url)) ?? parsed[0] ?? new URL(fallbackSiteUrl);
  }

  return parsed[0] ?? new URL(fallbackSiteUrl);
}

export const siteUrl = getSiteUrl();
export const siteOrigin = siteUrl.origin;

export function absoluteUrl(path = "/") {
  return new URL(path, siteUrl).toString();
}
