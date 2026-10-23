import assert from "node:assert/strict";
import test from "node:test";
import { assertCloudinaryAssetPair, isManagedCloudinaryUrl } from "@/lib/cloudinary-assets";

/**
 * Cloudinary asset pairing.
 *
 * Cloudinary keeps the format out of `public_id` but appends it to the delivery
 * URL, so a genuine upload returns
 *
 *   secure_url: https://res.cloudinary.com/<cloud>/image/upload/<transform>/event-management/services/photo.jpg
 *   public_id:  event-management/services/photo
 *
 * Comparing the raw pathname against the public id therefore failed for every
 * real upload, and the save was rejected with "Invalid Cloudinary asset URL."
 * from every image field in the admin panel.
 *
 * `lib/cloudinary.ts` re-exports these, so the create and update actions under
 * test use the very same implementation.
 */

const CLOUD = "demo-cloud";
const PUBLIC_ID = "event-management/services/golden-hour-setup";
const SECURE_URL = `https://res.cloudinary.com/${CLOUD}/image/upload/v1717171717/${PUBLIC_ID}.jpg`;
const TRANSFORMED_URL = `https://res.cloudinary.com/${CLOUD}/image/upload/c_limit,h_2400,w_2400/${PUBLIC_ID}.jpg`;
const WEBP_URL = `https://res.cloudinary.com/${CLOUD}/image/upload/${PUBLIC_ID}.webp`;

test("a real upload URL is accepted with its public id", () => {
  assert.doesNotThrow(() => assertCloudinaryAssetPair(SECURE_URL, PUBLIC_ID));
});

test("an upload-time transformation does not break the match", () => {
  assert.doesNotThrow(() => assertCloudinaryAssetPair(TRANSFORMED_URL, PUBLIC_ID));
});

test("the delivered format may differ from the stored one", () => {
  assert.doesNotThrow(() => assertCloudinaryAssetPair(WEBP_URL, PUBLIC_ID));
});

test("a URL pointing at a different asset is still refused", () => {
  assert.throws(
    () => assertCloudinaryAssetPair(`https://res.cloudinary.com/${CLOUD}/image/upload/event-management/services/somebody-else.jpg`, PUBLIC_ID),
    /Invalid Cloudinary asset URL/,
  );
});

test("a URL from another category is refused even with a matching file name", () => {
  assert.throws(
    () => assertCloudinaryAssetPair(`https://res.cloudinary.com/${CLOUD}/image/upload/event-management/inventory/golden-hour-setup.jpg`, PUBLIC_ID),
    /Invalid Cloudinary asset URL/,
  );
});

test("non-HTTPS delivery is refused", () => {
  assert.throws(() => assertCloudinaryAssetPair(SECURE_URL.replace("https://", "http://"), PUBLIC_ID), /HTTPS/);
});

test("a malformed URL is refused", () => {
  assert.throws(() => assertCloudinaryAssetPair("not-a-url", PUBLIC_ID), /Invalid Cloudinary asset URL/);
});

test("a public id outside the managed folder is refused", () => {
  assert.throws(() => assertCloudinaryAssetPair(SECURE_URL, "somebody-else/uploads/photo"), /Invalid Cloudinary asset reference/);
  assert.throws(() => assertCloudinaryAssetPair(SECURE_URL, "event-management/../../etc/passwd"), /Invalid Cloudinary asset reference/);
});

test("clearing an image is allowed, and a lone field is not cross-checked", () => {
  assert.doesNotThrow(() => assertCloudinaryAssetPair(null, null));
  assert.doesNotThrow(() => assertCloudinaryAssetPair(SECURE_URL, null));
});

test("isManagedCloudinaryUrl only trusts the managed delivery host", () => {
  assert.equal(isManagedCloudinaryUrl(SECURE_URL), true);
  assert.equal(isManagedCloudinaryUrl("https://example.com/event-management/services/photo.jpg"), false);
  assert.equal(isManagedCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/other-folder/photo.jpg"), false);
  assert.equal(isManagedCloudinaryUrl(null), false);
});
