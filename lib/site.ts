const fallbackSiteUrl = "http://localhost:3000";

function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return new URL(fallbackSiteUrl);
  try {
    return new URL(configured);
  } catch {
    return new URL(fallbackSiteUrl);
  }
}

export const siteUrl = getSiteUrl();
export const siteOrigin = siteUrl.origin;

export function absoluteUrl(path = "/") {
  return new URL(path, siteUrl).toString();
}
