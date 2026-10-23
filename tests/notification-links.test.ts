import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The notifications screen.
 *
 * The complaint was that the list showed the text of each alert and nothing
 * else, so there was no way to get from a notification to the thing it was
 * about. The bell dropdown has always linked; the full list did not.
 */

const page = readFileSync("app/(admin)/admin/notifications/page.tsx", "utf8");
const centre = readFileSync("components/admin/notification-center.tsx", "utf8");

test("every notification in the list links to what it is about", () => {
  assert.match(page, /toNotificationView\(notification, "ADMIN"\)/, "the list must resolve the target of each notification");
  assert.match(page, /<Link href=\{view\.href\}/, "each notification must be a link to its target");
});

test("the list keeps the mark-read control", () => {
  // The link says where it is; the button says "I have dealt with it". Both
  // are wanted, so a reader can acknowledge an alert without leaving the
  // inbox.
  assert.match(page, /markNotificationFormAction/, "the mark-read control must remain");
  assert.match(page, /markAllNotificationsFormAction/, "the mark-all control must remain");
});

test("the bell dropdown links to the same place", () => {
  assert.match(centre, /href=\{item\.href\}/, "the dropdown must link to the notification's target");
});
