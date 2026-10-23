/**
 * Cloudinary asset-reference validation.
 *
 * Split out from `lib/cloudinary.ts` because it is pure string logic with no
 * SDK and no credentials, which is what lets it be unit tested.
 *
 * Cloudinary keeps the format out of `public_id` but appends it to the delivery
 * URL, so a genuine upload returns
 *
 *   secure_url: https://res.cloudinary.com/<cloud>/image/upload/<transform>/event-management/services/photo.jpg
 *   public_id:  event-management/services/photo
 *
 * Comparing the raw pathname against the public id therefore failed for every
 * real upload and the save was rejected with "Invalid Cloudinary asset URL."
 * from every image field in the admin panel.
 */

export const MANAGED_PREFIX = "event-management/";

/**
 * Only the delivery format is stripped. A public id may legitimately contain a
 * dot, so the trailing extension is removed from the URL rather than guessed at
 * from the public id.
 */
const DELIVERY_EXTENSION = /\.[a-z0-9]{2,5}$/i;

export function isManagedCloudinaryUrl(imageUrl: string | null | undefined) {
  if (!imageUrl) return false;
  try {
    const parsed = new URL(imageUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "res.cloudinary.com" &&
      decodeURIComponent(parsed.pathname).includes(`/${MANAGED_PREFIX}`)
    );
  } catch {
    return false;
  }
}

/**
 * Cross-checks the delivery URL against the public id that was stored with it,
 * so a hand-crafted form cannot attach somebody else's asset to a record.
 */
export function assertCloudinaryAssetPair(imageUrl: string | null | undefined, publicId: string | null | undefined) {
  if (!publicId && !imageUrl) return;
  if (publicId && (!publicId.startsWith(MANAGED_PREFIX) || publicId.includes(".."))) {
    throw new Error("Invalid Cloudinary asset reference.");
  }
  if (!imageUrl || !publicId) return;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("Invalid Cloudinary asset URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Cloudinary asset URL must use HTTPS.");

  // An upload-time transformation is part of the delivery path, so only the
  // segment that follows it identifies the asset.
  const pathname = decodeURIComponent(parsed.pathname).replace(DELIVERY_EXTENSION, "");
  if (!pathname.endsWith(`/${publicId}`)) throw new Error("Invalid Cloudinary asset URL.");
}
