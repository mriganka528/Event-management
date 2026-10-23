import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { businessSettingsSchema } from "@/lib/validation";

/**
 * The business logo.
 *
 * It is the first image on the public site, and it is the one image that was not
 * already covered by the rules every other asset follows. Three of them had to be
 * copied across deliberately, because each is a place where a half-finished logo
 * looks fine until it matters:
 *
 *  - it is stored as the `url`/`publicId` **pair**, so a replacement can destroy
 *    the asset it replaces instead of orphaning it in the bucket forever;
 *  - it is validated by the same Cloudinary rules as a service image, so the URL
 *    cannot be pointed at somebody else's asset;
 *  - it is **optional**, and the header falls back to the business name. A logo
 *    field that is required would lock a business out of saving its settings
 *    until it uploaded artwork.
 */

const settingsAction = readFileSync("lib/actions.ts", "utf8");
const header = readFileSync("components/layout/site-header.tsx", "utf8");
const settingsPage = readFileSync("app/(admin)/admin/settings/page.tsx", "utf8");
const homePage = readFileSync("app/(root)/page.tsx", "utf8");

test("the logo is optional, and a half-supplied pair is refused", () => {
  const base = { businessName: "MJ Event House", email: "hello@example.com", phone: "9876543210", address: "1 Event Road", city: "Jaipur", taxRate: 0.18, currency: "inr" };
  assert.equal(businessSettingsSchema.parse({ ...base }).logoUrl, undefined, "settings must save without a logo");

  const url = "https://res.cloudinary.com/demo/image/upload/v1/event-management/business/logo.png";
  assert.equal(businessSettingsSchema.parse({ ...base, logoUrl: url }).logoUrl, url);
  assert.equal(businessSettingsSchema.parse({ ...base, logoUrl: url, logoPublicId: "event-management/business/logo" }).logoPublicId, "event-management/business/logo");

  // An address that is not a managed Cloudinary delivery URL, the same rule every
  // other image follows.
  assert.equal(businessSettingsSchema.safeParse({ ...base, logoUrl: "https://example.com/logo.png" }).success, false);
  assert.equal(businessSettingsSchema.safeParse({ ...base, logoUrl: "javascript:alert(1)" }).success, false);
  // And the form cannot smuggle a field past the strict object.
  assert.equal(businessSettingsSchema.safeParse({ ...base, logoPublicIdOnly: "x" }).success, false);
});

test("replacing the logo destroys the asset it replaced", () => {
  // Otherwise every logo the business has ever used stays in the bucket, at full
  // delivery size, with nothing pointing at it.
  assert.match(settingsAction, /const previous = await prisma\.businessSetting\.findUnique\(\{ where: \{ id: "default" \}, select: \{ logoPublicId: true \} \}\)/);
  assert.match(settingsAction, /if \(previous\?\.logoPublicId && previous\.logoPublicId !== data\.logoPublicId\) \{\s*await deleteCloudinaryImage\(previous\.logoPublicId\);/);
  // The pair is checked before anything is written, or a half-set logo is stored
  // and can never be replaced again.
  assert.match(settingsAction, /assertCloudinaryAssetPair\(data\.logoUrl \|\| null, data\.logoPublicId \|\| null\)/);
});

test("the settings form uploads the logo through the Cloudinary field", () => {
  assert.match(settingsPage, /<ImageUploader folder="business" name="logoUrl" publicIdName="logoPublicId" label="Business logo"/);
  // The stored values come back into the field, so opening settings shows the
  // logo that is live rather than an empty uploader.
  assert.match(settingsPage, /defaultUrl=\{settings\.logoUrl\} defaultPublicId=\{settings\.logoPublicId\}/);
});

test("the public header shows the logo and keeps working without one", () => {
  assert.match(header, /logoUrl\?: string \| null/);
  assert.match(header, /\{logoUrl \? \(/);
  // The alt text is the business name, not the word "logo" — that is what the
  // image is to somebody using a screen reader.
  assert.match(header, /<Image src=\{logoUrl\} alt=\{name\}/);
  // The name is still rendered either way, so an upload is an addition rather
  // than a swap.
  assert.match(header, /<span className="block max-w-\[9rem\] truncate sm:max-w-none">\{name\}<\/span>/);
});

test("every public page passes the logo to the header", () => {
  // A logo on the home page and not on the services page is not "reflected on the
  // public site"; each page renders the header itself, so each has to hand it over.
  const pages = [
    "app/(root)/page.tsx",
    "app/(root)/contact/page.tsx",
    "app/(root)/services/page.tsx",
    "app/(root)/services/[slug]/page.tsx",
    "app/(root)/packages/page.tsx",
    "app/(root)/packages/[slug]/page.tsx",
  ];
  for (const page of pages) {
    const source = readFileSync(page, "utf8");
    assert.match(source, /<SiteHeader\b[^>]*logoUrl=/, `${page} renders the header without the logo`);
    // …and asked the database for it. Either an explicit `select`, or — as on the
    // landing page, which builds its settings object by hand — the whole row.
    const readsIt =
      /select: \{[^}]*logoUrl: true/.test(source) || /businessSetting\.findUnique\(\{ where: \{ id: "default" \} \}\)/.test(source);
    assert.ok(readsIt, `${page} never reads logoUrl from the database, so there is nothing to pass`);
  }
  // The home page builds its settings object by hand, so the field has to be in
  // the type and the fallback or the header is handed `undefined` on a cold read.
  assert.match(homePage, /logoUrl: string \| null/);
  assert.match(homePage, /logoUrl: null \}/);
});

test("saving the settings republishes the pages that show the logo", () => {
  // The marketing pages are statically cached, so a logo saved now would not
  // appear until the revalidate window expired on its own.
  for (const path of ["/", "/contact", "/services", "/packages"]) {
    assert.ok(settingsAction.includes(`revalidatePath("${path}")`), `saving the logo must republish ${path}`);
  }
});
