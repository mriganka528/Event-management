import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Cancellation policy.
 *
 * A customer may withdraw a request while it is still a request. Once the team
 * accepts it they have committed a date, stock, and staff; undoing that is an
 * operational decision with refund consequences, not a dashboard button. The
 * admin transition table is intentionally unchanged — an administrator can still
 * cancel an approved booking after resolving any captured payment.
 */

const actions = readFileSync("lib/actions.ts", "utf8");
const cancelAction = actions.slice(
  actions.indexOf("export async function cancelBookingAction"),
  actions.indexOf("export async function markAllNotificationsReadAction"),
);

test("the customer cancellation checks the status before it changes anything", () => {
  const guardIndex = cancelAction.indexOf("booking.status !== BookingStatus.PENDING");
  const updateIndex = cancelAction.indexOf('updateBookingStatus(bookingId, "CANCELLED")');
  assert.ok(guardIndex > -1, "cancellation must refuse anything past PENDING");
  assert.ok(updateIndex > -1, "the update is still the thing that follows the guard");
  assert.ok(guardIndex < updateIndex, "the guard has to run first");
  assert.match(cancelAction, /already been reviewed/);
});

test("the action cannot be bypassed by posting another customer's booking id", () => {
  assert.match(cancelAction, /current\.customerProfile/);
  assert.match(cancelAction, /booking\.customerId !== current\.customerProfile\.id/);
});

test("the admin transition table still allows an approved booking to be cancelled", () => {
  const bookings = readFileSync("lib/bookings.ts", "utf8");
  const table = bookings.slice(bookings.indexOf("const allowedStatusTransitions"), bookings.indexOf("const allowedStatusTransitions") + 600);
  assert.match(table, /APPROVED: \[BookingStatus\.PREPARING, BookingStatus\.CANCELLED\]/);
  assert.match(table, /PREPARING: \[BookingStatus\.COMPLETED, BookingStatus\.CANCELLED\]/);
});

test("the dashboard only offers cancellation for pending, unpaid requests", () => {
  const dashboard = readFileSync("app/(customer)/customer/dashboard/page.tsx", "utf8");
  assert.match(
    dashboard,
    /booking\.status === BookingStatus\.PENDING && Number\(booking\.paidAmount\) === 0/,
    "the cancellable list must be restricted to pending requests",
  );
  assert.match(dashboard, /Once the team approves it/);
});

test("the booking detail screen states the same policy", () => {
  const detail = readFileSync("app/(customer)/customer/bookings/[id]/page.tsx", "utf8");
  assert.match(detail, /booking\.status === BookingStatus\.PENDING/);
  assert.match(detail, /until the team reviews it/);
  assert.match(detail, /already reviewed this booking/);
  assert.match(
    detail,
    /payable && payment\.requested !== null/,
    "a closed booking must not invite the customer to pay a stale request",
  );
});

test("the admin operational controls lock once a booking is cancelled", () => {
  const operations = readFileSync("components/admin/booking-operations.tsx", "utf8");
  assert.match(operations, /const operationsLocked = status === BookingStatus\.CANCELLED \|\| status === BookingStatus\.REJECTED/);
  assert.match(operations, /Payment requests are closed for this booking/);
  assert.match(operations, /Payments cannot be recorded on a cancelled or declined booking/);
  assert.match(operations, /Invoices cannot be generated for a cancelled or declined booking/);
  assert.match(operations, /Calendar events are locked for this booking/);
  assert.match(operations, /Staff assignments are locked for this booking/);

  // Read-only invoice actions stay available even when the booking is closed.
  const invoiceSection = operations.slice(operations.indexOf("Invoice</h2>"), operations.indexOf("Calendar event</h2>"));
  assert.match(invoiceSection, /InvoiceViewLink/);
  assert.match(invoiceSection, /InvoiceDownloadButton/);
});

test("the payments and invoice card offers a way to read the invoice", () => {
  const detail = readFileSync("app/(admin)/admin/bookings/[id]/page.tsx", "utf8");
  const card = detail.slice(detail.indexOf("Payments and invoice"), detail.indexOf("Operational readiness"));
  assert.match(card, /InvoiceViewLink/);
  assert.match(card, /InvoiceDownloadButton/);
  assert.match(card, /Pending generation/);
});

test("the bookings table keeps a single row action", () => {
  const list = readFileSync("app/(admin)/admin/bookings/page.tsx", "utf8");
  assert.doesNotMatch(list, /InvoiceViewLink/, "invoice access belongs on the booking detail, not the table row");
});

test("staff cannot be unassigned from a booking that is no longer active", () => {
  const actions = readFileSync("lib/actions.ts", "utf8");
  const unassign = actions.slice(
    actions.indexOf("export async function unassignStaffAction"),
    actions.indexOf("export async function cancelBookingAction"),
  );
  assert.match(unassign, /assignableStatuses: BookingStatus\[\] = \[BookingStatus\.PENDING, BookingStatus\.APPROVED, BookingStatus\.PREPARING\]/);
  assert.match(unassign, /booking: \{ status: \{ in: assignableStatuses \} \}/);
  assert.match(unassign, /Staff assignments can only be changed on active bookings/);
});

test("cancelling clears a payment request the customer can no longer pay", () => {
  const bookings = readFileSync("lib/bookings.ts", "utf8");
  const update = bookings.slice(
    bookings.indexOf("export async function updateBookingStatus"),
    bookings.indexOf("export async function createPayment"),
  );
  assert.match(update, /nextStatus === BookingStatus\.CANCELLED \|\| nextStatus === BookingStatus\.REJECTED/);
  assert.match(update, /paymentRequestMode: null/);
  assert.match(update, /paymentRequestTargetAmount: null/);
  assert.match(update, /paymentRequestedAt: null/);
});
