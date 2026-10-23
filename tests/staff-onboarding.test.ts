import assert from "node:assert/strict";
import test from "node:test";
import { StaffType } from "@prisma/client";
import { STAFF_INVITE_TTL_DAYS, isStaffInviteExpired, staffInviteExpiresAt, staffInviteUrl } from "@/lib/staff-invite";
import { notificationHref, toNotificationView } from "@/lib/notification-links";

test("staff invite links expire after the configured TTL", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const expires = staffInviteExpiresAt(now);
  const days = (expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(days, STAFF_INVITE_TTL_DAYS);
  assert.equal(isStaffInviteExpired(expires, new Date(expires.getTime() - 1000)), false);
  assert.equal(isStaffInviteExpired(expires, new Date(expires.getTime() + 1000)), true);
  assert.equal(isStaffInviteExpired(null, now), false);
});

test("staff invite url points at the public activation route", () => {
  assert.match(staffInviteUrl("abc-123"), /\/staff\/invite\/abc-123$/);
});

test("every onboarding notification type routes to a real admin page", () => {
  const expected: Record<string, string> = {
    NEW_BOOKING_REQUEST: "/admin/bookings?status=PENDING",
    LOW_INVENTORY: "/admin/inventory",
    STAFF_REQUEST: "/admin/admins",
    STAFF_INVITE: "/admin/staff",
    STAFF_ACTIVATED: "/admin/staff",
    PAYMENT_RECEIVED: "/admin/payments",
  };
  for (const [type, href] of Object.entries(expected)) {
    assert.equal(notificationHref(type, "ADMIN"), href);
  }
  // Unknown types fall back instead of producing a dead link.
  assert.equal(notificationHref("SOMETHING_NEW", "ADMIN"), "/admin");
  // An explicit href always wins.
  assert.equal(notificationHref("LOW_INVENTORY", "ADMIN", "/admin/settings"), "/admin/settings");
});

test("staff invite notifications send the invitee to their workspace", () => {
  assert.equal(notificationHref("STAFF_INVITE", "CUSTOMER"), "/staff");
  assert.equal(notificationHref("BOOKING_APPROVED", "CUSTOMER"), "/customer/dashboard");
});

test("toNotificationView normalises dates and defaults the href", () => {
  const view = toNotificationView(
    { id: "n1", title: "New booking request", message: "Someone booked", type: "NEW_BOOKING_REQUEST", read: false, createdAt: new Date("2026-01-02T03:04:05.000Z") },
    "ADMIN",
  );
  assert.equal(view.href, "/admin/bookings?status=PENDING");
  assert.equal(view.createdAt, "2026-01-02T03:04:05.000Z");
  assert.equal(view.read, false);
});

test("the stored link wins over the per-type default", () => {
  /*
   * The link is recorded when the event happens, so it can point at the exact
   * screen the alert is about. A cash payment awaiting approval and a
   * recorded payment are both about money, but only one of them is about
   * waiting for approval, and the reader has to be able to get to it.
   */
  const view = toNotificationView(
    { id: "n2", title: "Cash payment awaiting approval", message: "Approve it", type: "PAYMENT_REQUESTED", read: false, createdAt: new Date("2026-01-02T03:04:05.000Z"), href: "/admin/payments" },
    "ADMIN",
  );
  assert.equal(view.href, "/admin/payments");
});

test("a notification without a stored link still gets one", () => {
  // Rows written before the column existed, or created without a link, must
  // not end up pointing nowhere.
  const view = toNotificationView(
    { id: "n3", title: "New booking request", message: "Someone booked", type: "NEW_BOOKING_REQUEST", read: false, createdAt: new Date("2026-01-02T03:04:05.000Z"), href: null },
    "ADMIN",
  );
  assert.equal(view.href, "/admin/bookings?status=PENDING");
});

test("staff roles offered at approval are the supported staff types", () => {
  const options = Object.values(StaffType);
  assert.deepEqual(options.sort(), ["DECORATOR", "DRIVER", "ELECTRICIAN", "TENT_INSTALLER"]);
});
