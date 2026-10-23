import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Live payment alerts.
 *
 * The complaint was that money moving produced no alert. The popup, the
 * chime, and the operating system's notification all existed, but only for the
 * handful of events that happened to create an admin notification row: a cash
 * declaration and a booking request. A payment received online, a payment
 * recorded by hand, and a cash approval all went through silently.
 *
 * The events themselves are not visible in a type check or a code review —
 * they only show up when money arrives and nobody is told — so the wiring is
 * pinned here.
 */

const bookings = readFileSync("lib/bookings.ts", "utf8");
const cash = readFileSync("lib/cash-payments.ts", "utf8");
const razorpay = readFileSync("lib/razorpay-payments.ts", "utf8");
const actions = readFileSync("lib/actions.ts", "utf8");
const notifications = readFileSync("lib/notifications.ts", "utf8");
const centre = readFileSync("components/admin/notification-center.tsx", "utf8");
const announce = readFileSync("components/notifications/announce.tsx", "utf8");
const toaster = readFileSync("components/providers/app-toaster.tsx", "utf8");
const links = readFileSync("lib/notification-links.ts", "utf8");

test("a payment recorded by hand alerts the admins", () => {
  assert.match(bookings, /notifyAdminsSafely\(\{[\s\S]*NotificationType\.PAYMENT_RECEIVED[\s\S]*Manual payment recorded/);
  // The alert is raised after the money moved, so a notification failure can
  // never roll the payment back.
  const payment = bookings.indexOf("export async function createPayment");
  const alert = bookings.indexOf("Manual payment recorded");
  assert.ok(alert > payment, "the alert must belong to the payment path");
});

test("an online payment alerts the admins", () => {
  assert.match(razorpay, /notifyAdminsSafely\(\{[\s\S]*NotificationType\.PAYMENT_RECEIVED[\s\S]*Online payment received/);
});

test("a cash approval and a cash refusal both alert the admins", () => {
  assert.match(cash, /notifyAdmins\(\{[\s\S]*NotificationType\.PAYMENT_RECEIVED[\s\S]*Cash payment approved/);
  assert.match(cash, /notifyAdmins\(\{[\s\S]*NotificationType\.PAYMENT_REQUESTED[\s\S]*Cash payment declined/);
});

test("a failed online payment alerts the admins", () => {
  // A payment that fails is money that did not arrive, and the team has to
  // know that the reserved balance was released.
  assert.match(razorpay, /notifyAdminsSafely\(\{[\s\S]*NotificationType\.PAYMENT_REQUESTED[\s\S]*Online payment failed/);
  assert.match(razorpay, /Online checkout could not start/);
});

test("sending and withdrawing a payment request is recorded for the team", () => {
  assert.match(actions, /notifyAdminsSafely\(\{[\s\S]*NotificationType\.PAYMENT_REQUESTED[\s\S]*Payment request sent/);
  assert.match(actions, /notifyAdminsSafely\(\{[\s\S]*NotificationType\.PAYMENT_REQUESTED[\s\S]*Payment request withdrawn/);
});

test("the payment alert never turns a recorded payment into an error", () => {
  // A notification outage must not make a successful payment look failed.
  assert.match(notifications, /export async function notifyAdminsSafely/);
  assert.match(notifications, /catch \(error\)[\s\S]*Admin notification failed/);
  for (const source of [bookings, razorpay, actions]) {
    assert.ok(source.includes("notifyAdminsSafely"), "the payment paths must use the safe wrapper");
  }
});

test("the alert points at the booking the money is about", () => {
  assert.match(bookings, /href: `\/admin\/bookings\/\$\{result\.payment\.bookingId\}`/);
  assert.match(razorpay, /href: `\/admin\/bookings\/\$\{result\.payment\.bookingId\}`/);
});

test("payment request notifications have a default destination", () => {
  // Without a per-type entry the link would fall back to the admin home, so
  // a payment alert that lost its stored link would go nowhere useful.
  assert.match(links, /PAYMENT_REQUESTED: "\/admin\/payments"/);
  assert.match(links, /PAYMENT_REQUESTED: "\/customer\/dashboard"/);
});

test("the notification popup carries a close button", () => {
  // The reader has to be able to dismiss a popup without waiting for it to
  // time out.
  assert.match(announce, /aria-label="Dismiss notification"/);
  assert.match(announce, /toast\.dismiss\(toastItem\.id\)/);
  assert.match(announce, /<X className="h-4 w-4" \/>/);
});

test("every shared toast carries a close button", () => {
  // Not only the realtime popup: an error the team has read and understood
  // should be closable too.
  assert.match(toaster, /ToastBar/);
  assert.match(toaster, /aria-label="Close notification"/);
  assert.match(toaster, /toast\.dismiss\(item\.id\)/);
});

test("the notification list offers a per-item close", () => {
  assert.match(centre, /dismissItem\(item\)/);
  assert.match(centre, /aria-label=\{`Dismiss notification: \$\{item\.title\}`\}/);
});

test("the admin notification centre announces every arrival once", () => {
  // The socket and the polling fallback both deliver the same notification,
  // so it must be announced exactly once.
  assert.match(centre, /const announced = useRef<Set<string> \| null>\(null\)/);
  assert.match(centre, /applyServerList/);
  assert.match(centre, /for \(const item of fresh\) announce\(item\)/);
});

test("a deployment without a custom server still receives payment alerts", () => {
  // Vercel runs the Next.js request handlers, not server.mjs, so Socket.IO never
  // connects there. The live path is the SSE route, with the focused poll as a
  // fallback for a blocked stream.
  assert.match(centre, /new EventSource\("\/api\/realtime"\)/);
  assert.match(centre, /addEventListener\("notifications"/);
  assert.match(centre, /\/api\/admin\/notifications/);
  assert.match(centre, /window\.setInterval\(poll, 10_000\)/);

  const stream = readFileSync("app/api/realtime/route.ts", "utf8");
  assert.match(stream, /text\/event-stream/);
  assert.match(stream, /requireApiUser/);
  assert.match(stream, /toNotificationView\(notification, audienceLabel\)/);
  assert.match(stream, /maxDuration = 300/);

  assert.match(readFileSync("app/api/admin/notifications/route.ts", "utf8"), /requireApiAdmin/);
  assert.match(readFileSync("app/api/customer/notifications/route.ts", "utf8"), /requireApiCustomer/);
});

test("the browser does not depend on the custom Socket.IO server", () => {
  // The custom server is still useful for a long-lived Node deployment, but the
  // client must not require it. Otherwise every Vercel tab retries a socket that
  // is not deployed and the indicator sits on "Offline".
  assert.doesNotMatch(centre, /socket\.io-client/);
  assert.doesNotMatch(readFileSync("components/customer/notification-listener.tsx", "utf8"), /socket\.io-client/);
});

test("the customer is told the moment their payment lands", () => {
  /*
   * The customer dashboard is where a customer checks whether their payment
   * arrived. Without a live alert they refresh, see nothing, and pay again.
   */
  const listener = readFileSync("components/customer/notification-listener.tsx", "utf8");
  assert.match(listener, /announceNotification\(/, "a customer's own notification must be announced");
  assert.match(listener, /\/api\/customer\/notifications/);
  assert.match(listener, /new EventSource\("\/api\/realtime"\)/);
  assert.match(listener, /window\.setInterval\(/);
  // The stream handshake takes a moment, so a notification created during it
  // has to be fetched.
  assert.match(listener, /source\.onopen[\s\S]*catchUp\(\)/);

  const layout = readFileSync("app/(customer)/customer/layout.tsx", "utf8");
  assert.match(layout, /CustomerNotificationListener/);
});

test("the customer and the admin announce a notification the same way", () => {
  // Two implementations of "tell the reader" would drift, and one of them
  // would quietly stop making a sound.
  const listener = readFileSync("components/customer/notification-listener.tsx", "utf8");
  assert.match(listener, /from "@\/components\/notifications\/announce"/);
  assert.match(centre, /from "@\/components\/notifications\/announce"/);
});
