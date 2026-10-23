const fallbackSiteUrl = "http://localhost:3000";

function parseSiteUrl(value: string | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Only the origin belongs in canonical URLs. A trailing path or slash in
    // the environment variable must not leak into the sitemap or metadata.
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/**
 * The canonical public origin.
 *
 * Production and preview deployments read `NEXT_PUBLIC_SITE_URL` from the
 * Vercel project environment. Local development deliberately has no such value
 * in the example env, so it falls back to the port the dev server uses.
 */
export function getSiteUrl() {
  return parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? new URL(fallbackSiteUrl);
}

export const siteUrl = getSiteUrl();
export const siteOrigin = siteUrl.origin;

export function absoluteUrl(path = "/") {
  return new URL(path, siteUrl).toString();
}
