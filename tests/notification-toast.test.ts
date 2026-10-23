import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The realtime notification popup.
 *
 * `toast.custom` renders the markup it is given and, unlike `toast.success` and
 * `toast.error`, never applies `toastOptions.style`. The background, border and
 * shadow configured once in `AppToaster` therefore did not reach this popup at
 * all: the alert arrived as unstyled text on the page, and the only thing
 * visible was the dismiss button floating in the corner.
 *
 * Nothing about that failure is visible in a code review or a type check — it
 * only shows up once a notification arrives — so the required declarations are
 * pinned here.
 */

const centre = readFileSync("components/admin/notification-center.tsx", "utf8");
const toaster = readFileSync("components/providers/app-toaster.tsx", "utf8");
// The popup itself lives in the shared module, so the admin centre and the
// customer listener raise the same alert.
const announce = readFileSync("components/notifications/announce.tsx", "utf8");

test("the shared toaster styles the built-in toast types", () => {
  // The source of the properties the custom popup now has to restate for itself.
  assert.match(toaster, /background:\s*"var\(--card-elevated\)"/, "the toaster must paint an opaque surface");
  assert.match(toaster, /color:\s*"var\(--foreground\)"/, "the toaster must set a readable ink");
});

test("the realtime popup declares its own background, border and ink", () => {
  const start = announce.indexOf("toast.custom");
  assert.notEqual(start, -1, "the shared module must raise a realtime popup");
  const popup = announce.slice(start, announce.indexOf("{ icon: null", start));

  assert.match(popup, /bg-\[var\(--card-elevated\)\]/, "the popup must carry its own background; `toast.custom` ignores toastOptions.style");
  assert.match(popup, /text-\[var\(--foreground\)\]/, "the popup must set its own ink colour");
  assert.match(popup, /border-\[var\(--line-strong\)\]/, "the popup must be separated from the page behind it");
  assert.match(popup, /shadow-\[/, "the popup must lift off the page");
  assert.match(popup, /break-words/, "a long alert must wrap rather than overflow the corner");
});

test("the popup is announced to assistive technology", () => {
  assert.match(announce, /role="status"/, "a realtime alert needs a live region or it is invisible to a screen reader");
});

test("the browser notification is separate and still enabled", () => {
  // Two channels on purpose: the in-page popup for an admin at their desk, the
  // OS notification for one in another tab.
  assert.match(announce, /new window\.Notification\(/, "the OS notification path must remain");
  assert.match(centre, /requestPermission/, "the enable-alerts control must remain");
});

test("a new notification makes a sound", () => {
  // The chime is what reaches somebody whose tab is in the background, where
  // the in-page popup is not visible.
  assert.match(announce, /playNotificationSound\(\)/, "an arriving notification must play a sound");
  assert.match(centre, /handleToggleSound/, "the reader must be able to turn the sound off");
});

test("a notification is read once its target page is reached", () => {
  // The complaint was that notifications stayed unread unless the bell was the
  // thing that was clicked. Reaching the page the notification is about has to
  // count, whichever way the reader got there.
  assert.match(centre, /isSameDestination/, "the current page must be compared with the notification's target");
  assert.match(centre, /markNotificationsSeenAction\(/, "reaching the page must persist the read state");
});

test("the sound is remembered and unlocked by a gesture", () => {
  // Browsers refuse to start audio before the reader has interacted with the
  // page, so the context is unlocked on a gesture rather than on the
  // notification, and the preference survives a reload.
  const sound = readFileSync("lib/notification-sound.ts", "utf8");
  assert.match(sound, /localStorage/, "the preference must be remembered");
  assert.match(sound, /unlockNotificationSound/, "the audio context must be unlocked by a gesture");
});
