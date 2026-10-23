import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatBytes } from "@/lib/image-prepare";

/**
 * Image upload speed and correctness.
 *
 * The slow part was never the Cloudinary call: a phone photo is routinely
 * several megabytes, every one of those bytes travelled to the app server and
 * again to Cloudinary, and the server then re-encoded it at 2400px — far larger
 * than any surface these images appear on. Both ends are pinned here because
 * the fix is invisible once it works and nobody would think to restore it.
 */

const uploader = readFileSync("components/admin/image-uploader.tsx", "utf8");
const cloudinary = readFileSync("lib/cloudinary.ts", "utf8");
const actionForm = readFileSync("components/forms/action-form.tsx", "utf8");
const inventoryPage = readFileSync("app/(admin)/admin/inventory/page.tsx", "utf8");
const prepare = readFileSync("lib/image-prepare.ts", "utf8");

test("the browser shrinks the file before it is sent", () => {
  assert.match(uploader, /prepareImageForUpload\(file\)/, "the uploader must prepare the file client-side");
  assert.match(prepare, /createImageBitmap/, "preparation must decode the image rather than resend it untouched");
  assert.match(prepare, /MAX_UPLOAD_DIMENSION/, "preparation must bound the longest edge");
  assert.match(uploader, /Optimised before sending/, "the saving must be reported rather than done silently");
});

test("preparation can never make things worse", () => {
  // Re-encoding a small, already-optimised PNG can grow it. Sending the original
  // is then faster, so the comparison has to be there.
  assert.match(prepare, /blob\.size >= file\.size/, "a larger re-encode must be discarded");
  assert.match(prepare, /MIN_BYTES_TO_REENCODE/, "an already-small file must skip the decode entirely");
  assert.match(prepare, /typeof createImageBitmap !== "function"/, "a browser without the API must fall back to the original");
  assert.match(prepare, /longest <= MAX_UPLOAD_DIMENSION/, "an image already within bounds must be left alone");
});

test("the server no longer buffers or over-transforms", () => {
  assert.doesNotMatch(cloudinary, /Buffer\.from\(await file\.arrayBuffer\(\)\)/, "the upload must stream, not buffer the whole file");
  assert.match(cloudinary, /Readable\.fromWeb/, "the upload must pipe the file stream to Cloudinary");
  // 2400px of unused pixels was the single most expensive part of the upload.
  assert.doesNotMatch(cloudinary, /width: 2400/, "the transform must not exceed what the app displays");
  assert.match(cloudinary, /width: 1600/, "the transform must bound the stored asset");
});

test("the preview appears before the server has answered", () => {
  assert.match(uploader, /URL\.createObjectURL/, "a local preview must exist while the upload is in flight");
  assert.match(uploader, /revokeObjectURL/, "an object URL per upload must be released, or a long session leaks one each time");
  assert.match(uploader, /url \|\| preview/, "the preview must stand in until the stored URL arrives");
});

test("a saved form starts empty again", () => {
  // `ImageUploader` seeds its URL from `useState(defaultUrl)` exactly once, so
  // after saving a new item the "Add …" panel kept showing the picture that had
  // just been attached to the item above it — ready to be saved onto the next
  // one. Remounting the form after a successful save resets every client child.
  assert.match(actionForm, /setFormKey\(\(key\) => key \+ 1\)/, "a successful save must remount the form");
  assert.match(actionForm, /<form key=\{formKey\}/, "the key has to be on the form element to reset its children");
});

test("the stock editor is a dialog, not a popover inside the table", () => {
  // Absolutely positioning a panel inside a table cell inside `overflow-x-auto`
  // inside `overflow-hidden` clipped it and dropped it underneath the row, and a
  // fixed `w-96` had no small-screen behaviour at all.
  assert.doesNotMatch(inventoryPage, /<details className="relative inline-block/, "the clipped popover must be gone");
  assert.match(inventoryPage, /<InventoryEditor/, "the row must open the dialog instead");
  assert.doesNotMatch(inventoryPage, /absolute right-0 z-20 mt-2 w-96/, "the fixed-width absolute panel must be gone");
});

test("formatBytes reads the way a person would say it", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("every image field's folder is one the upload endpoint accepts", () => {
  /*
   * `uploadCloudinaryImage` refuses a folder that is not on an allowlist, and the
   * refusal reads as a client fault rather than as a configuration mistake. A
   * field whose folder is missing from the list therefore looks broken and says
   * nothing about why — which is how the business logo would have failed while
   * every other uploader worked.
   */
  const allowed = new Set(
    [...cloudinary.matchAll(/const ALLOWED_FOLDERS = new Set\(\[([^\]]*)\]\)/g)].flatMap((match) => match[1].split(",").map((entry) => entry.trim().replace(/^"|"$/g, ""))),
  );
  assert.ok(allowed.size > 0, "could not read the folder allowlist, so the scan is broken");

  const fields: Array<[string, RegExp]> = [
    ["app/(admin)/admin/settings/page.tsx", /<ImageUploader\s+folder="([a-z]+)"/],
    ["app/(admin)/admin/inventory/page.tsx", /<ImageUploader\s+folder="([a-z]+)"/],
    ["app/(admin)/admin/services/page.tsx", /<ImageUploader\s+folder="([a-z]+)"/],
    ["app/(admin)/admin/packages/page.tsx", /<ImageUploader\s+folder="([a-z]+)"/],
  ];
  for (const [file, pattern] of fields) {
    const global = new RegExp(pattern.source, "g");
    for (const match of readFileSync(file, "utf8").matchAll(global)) {
      assert.ok(allowed.has(match[1]), `${file} uploads to "${match[1]}", which the endpoint would refuse`);
    }
  }
  assert.ok(allowed.has("business"), "the business logo needs its own folder");
});

test("the upload says what it is doing inside the field, not in a popup", () => {  // The progress toast sat over the form for the whole round trip, stacked up
  // when two images were attached one after the other, and left the field itself
  // reading "Drag an image here, or browse" while the button said "Uploading…".
  // Comments are stripped first: this file explains the old toast by name.
  const code = uploader
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*") && !line.trimStart().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(code, /toast\.loading/, "progress must not be announced as a popup");
  assert.match(code, /Uploading image to Cloudinary/);
  assert.match(code, /Optimising the image before upload/);
  assert.match(code, /role="status"/);
  assert.match(code, /aria-live="polite"/);
  // The outcome is still worth a toast: a failure has to reach an operator who
  // has scrolled away from the field.
  assert.match(code, /toast\.error\(message\)/);
  assert.match(code, /toast\.success\("Image uploaded to Cloudinary\."\)/);
});
