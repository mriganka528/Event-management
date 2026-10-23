import Link from "next/link";
import type { Metadata } from "next";
import { BookingStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  CreditCard,
  MapPin,
  Wallet,
} from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminBookingById } from "@/lib/admin-bookings";
import { bookingStatusBadgeClass } from "@/lib/booking-status";
import { istStartOfDay } from "@/lib/ist";
import { isAssignmentLive } from "@/lib/staff-assignment";
import { getStaffOptions } from "@/lib/admin-data";
import { unassignStaffFormAction } from "@/lib/form-actions";
import { BookingOperations } from "@/components/admin/booking-operations";
import { PendingCashApprovals } from "@/components/admin/pending-cash-approvals";
import { PaymentHistory } from "@/components/payments/payment-history";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoiceViewLink } from "@/components/invoices/invoice-view-link";
import { ActionForm } from "@/components/forms/action-form";
import { PAYMENT_REQUEST_LABEL, paymentRequestOutstanding } from "@/lib/payment-requests";
import { cn, formatCurrency, formatDate, formatEventDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking details",
  description: "One booking: quote, payments, inventory reservations, assigned staff, and event schedule.",
  robots: { index: false, follow: false, nocache: true },
};

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function BookingDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [booking, staff] = await Promise.all([getAdminBookingById(id), getStaffOptions()]);

  if (!booking) {
    notFound();
  }

  const customerName =
    `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""}`.trim();
  const totalReservedInventory = booking.bookingInventory.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const totalAssignedStaff = booking.bookingStaff.length;
  const packageServices = booking.package?.packageServices ?? [];
  const operationsLocked = booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED;
  /*
   * Whether the team has been released from this event.
   *
   * The event is over once its dates have passed or the booking has reached a
   * terminal state, and at that point the roster is a record of who worked it
   * rather than a list of people still to be booked. The people on it are free
   * for other events, and the buttons that would change it are not offered.
   */
  const teamReleased = !isAssignmentLive({
    status: booking.status,
    eventDate: booking.eventDate,
    durationDays: booking.durationDays,
  });
  const capturedPayments = booking.payments.filter((payment) => payment.status === PaymentStatus.CAPTURED);
  const pendingCashClaims = booking.payments
    .filter((payment) => payment.status === PaymentStatus.PENDING && payment.method === PaymentMethod.CASH)
    .map((payment) => ({
      id: payment.id,
      bookingId: booking.id,
      amount: Number(payment.amount),
      createdAt: payment.createdAt,
      customerName,
      bookingLocation: booking.location,
      balance: Number(booking.balanceAmount),
    }));
  const paidAmount = Number(booking.paidAmount);
  const balanceAmount = Number(booking.balanceAmount);
  const reservedAmount = Number(booking.reservedPaymentAmount);
  const availableBalance = Math.max(0, balanceAmount - reservedAmount);
  const advanceReceived = capturedPayments
    .filter((payment) => payment.stage === "ADVANCE")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const finalReceived = capturedPayments
    .filter((payment) => payment.stage === "FINAL")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const requestedDue = paymentRequestOutstanding({
    paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
    paidAmount,
    balanceAmount,
  });
  const remainingAfterRequest = requestedDue === null ? balanceAmount : Math.max(0, balanceAmount - requestedDue);
  // Newest first, including cash declarations that have not been approved yet.
  // A pending row has no `paidAt`, so fall back to its creation time.
  const paymentHistory = [...booking.payments].sort((a, b) => {
    const aTime = new Date(a.paidAt ?? a.createdAt).getTime();
    const bTime = new Date(b.paidAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-6 shadow-[0_20px_55px_rgba(61,40,14,0.08)] sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(211,138,22,0.18),transparent_28%),linear-gradient(150deg,rgba(255,255,255,0.42),transparent_62%)]" />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/bookings" className="inline-flex">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to bookings
              </Button>
            </Link>
            <Badge className={bookingStatusBadgeClass(booking.status)}>{formatEnum(booking.status)}</Badge>
            <Badge className="bg-[var(--surface-strong)] text-[var(--foreground)]">Booking ID {booking.id.slice(0, 8)}</Badge>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-5xl">
                {customerName}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
                {formatEnum(booking.eventType)} booking at {booking.location} for{" "}
                {booking.guestCount} guests. This page groups event, pricing, payment, inventory,
                staff, and invoice details into a single operational view.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {booking.invoice ? (
                <>
                  <InvoiceViewLink href={`/admin/invoices/${booking.invoice.id}`} variant="default" size="default" />
                  <InvoiceDownloadButton invoiceId={booking.invoice.id} label="Download PDF" />
                </>
              ) : null}
              <Link href="/admin/payments">
                <Button variant="outline">Payments hub</Button>
              </Link>
              <Link href="/admin/invoices">
                <Button variant="outline">Invoices hub</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Event date",
            value: formatEventDate(booking.eventDate),
            icon: CalendarRange,
          },
          {
            label: "Total amount",
            value: formatCurrency(booking.totalAmount),
            icon: CreditCard,
          },
          {
            label: "Paid so far",
            value: formatCurrency(booking.paidAmount),
            icon: CheckCircle2,
          },
          {
            label: "Balance due",
            value: formatCurrency(booking.balanceAmount),
            icon: Wallet,
          },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)]">
            <CardContent className="flex items-start justify-between gap-4 p-5">
              <div>
                <p className="text-sm text-[var(--muted)]">{label}</p>
                <p className="mt-3 text-xl font-semibold text-[var(--foreground)]">{value}</p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(211,138,22,0.14)] text-[var(--brand-dark)]">
                <Icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[var(--brand-dark)]" />
            Payments and invoice
          </CardTitle>
          <CardDescription>
            Every advance, requested instalment, cash declaration, and settlement for this booking.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Advance received", value: formatCurrency(advanceReceived) },
              { label: "Final received", value: formatCurrency(finalReceived) },
              { label: "Requested now", value: requestedDue === null ? "None" : formatCurrency(requestedDue) },
              {
                label: "Remaining after request",
                value: formatCurrency(remainingAfterRequest),
              },
            ].map((item) => (
              <div key={item.label} className="rounded-[20px] bg-[var(--surface-muted)] p-4">
                <p className="text-sm text-[var(--muted)]">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 rounded-[24px] border border-[var(--line)] p-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-sm text-[var(--muted)]">Active payment request</p>
              {requestedDue !== null && booking.paymentRequestMode ? (
                <>
                  <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                    {PAYMENT_REQUEST_LABEL[booking.paymentRequestMode]}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Outstanding on this request:{" "}
                    <span className="font-semibold text-[var(--foreground)]">{formatCurrency(requestedDue)}</span>
                  </p>
                  {booking.paymentRequestedAt ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Requested {formatDate(booking.paymentRequestedAt)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  No active payment request. Use the controls below to ask for a 25% advance, half of the
                  remaining balance, or the full balance.
                </p>
              )}
            </div>
            <div className="rounded-2xl bg-[var(--surface-muted)] p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--muted)]">Subtotal</span>
                <span>{formatCurrency(booking.subtotal)}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3">
                <span className="text-[var(--muted)]">Tax</span>
                <span>{formatCurrency(booking.taxAmount)}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3 border-t border-[var(--line)] pt-2 font-semibold">
                <span>Total</span>
                <span>{formatCurrency(booking.totalAmount)}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3 text-[var(--success-text)]">
                <span>Paid</span>
                <span>{formatCurrency(booking.paidAmount)}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3 font-semibold">
                <span>Balance due</span>
                <span>{formatCurrency(booking.balanceAmount)}</span>
              </div>
              {reservedAmount > 0 ? (
                <p className="mt-3 rounded-xl bg-[var(--warning-soft)] p-3 text-xs text-[var(--warning-text)]">
                  {formatCurrency(reservedAmount)} is reserved by an online checkout;{" "}
                  {formatCurrency(availableBalance)} is available to record manually.
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--foreground)]">Payment history</p>
              <Badge className="bg-[var(--surface-strong)] text-[var(--foreground)]">
                {booking.payments.length} record{booking.payments.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <PaymentHistory
              payments={paymentHistory}
              emptyMessage="No payments have been recorded for this booking yet."
            />
          </div>

          <div className="rounded-[24px] border border-[var(--line)] p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-[var(--muted)]">Invoice</p>
                <p className="mt-1 font-medium text-[var(--foreground)]">
                  {booking.invoice?.invoiceNumber ?? "No invoice created yet"}
                </p>
              </div>
              {booking.invoice ? (
                <div className="flex flex-wrap items-center gap-2">
                  <InvoiceViewLink href={`/admin/invoices/${booking.invoice.id}`} />
                  <InvoiceDownloadButton invoiceId={booking.invoice.id} />
                </div>
              ) : (
                <Badge className="bg-[var(--surface-strong)] text-[var(--foreground)]">Pending generation</Badge>
              )}
            </div>
            {booking.invoice ? (
              <div className="mt-4 grid gap-3 text-sm text-[var(--muted)] md:grid-cols-3">
                <p>Issued {formatDate(booking.invoice.issuedAt)}</p>
                <p>Total {formatCurrency(booking.invoice.totalAmount)}</p>
                <p>Balance {formatCurrency(booking.invoice.balanceAmount)}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <BookingOperations
        bookingId={booking.id}
        status={booking.status}
        balance={Math.max(0, Number(booking.balanceAmount) - Number(booking.reservedPaymentAmount))}
        paidAmount={Number(booking.paidAmount)}
        totalAmount={Number(booking.totalAmount)}
        paymentRequestMode={booking.paymentRequestMode}
        paymentRequestTargetAmount={booking.paymentRequestTargetAmount === null ? null : Number(booking.paymentRequestTargetAmount)}
        invoiceId={booking.invoice?.id ?? null}
        invoiceNumber={booking.invoice?.invoiceNumber ?? null}
        eventDate={istStartOfDay(booking.eventDate)?.toISOString() ?? booking.eventDate.toISOString()}
        location={booking.location}
        eventTitle={booking.event?.title}
        staff={staff.map((member) => ({
          id: member.id,
          name: `${member.user.firstName} ${member.user.lastName ?? ""}`.trim(),
          type: member.staffType,
          available: member.isAvailable,
        }))}
        assignedStaff={booking.bookingStaff.map((assignment) => ({
          assignmentId: assignment.id,
          id: assignment.staffId,
          name: `${assignment.staff.user.firstName} ${assignment.staff.user.lastName ?? ""}`.trim(),
          type: assignment.staff.staffType,
          assignedAt: assignment.assignedAt.toISOString(),
        }))}
        teamReleased={teamReleased}
      />

      <PendingCashApprovals claims={pendingCashClaims} />

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer and event</CardTitle>
              <CardDescription>Primary identity and logistics details for this booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4 rounded-[24px] bg-[var(--surface-muted)] p-5">
                <div>
                  <p className="text-sm text-[var(--muted)]">Customer name</p>
                  {/* `break-all`, like the rest of the admin screens: an address
                      has no spaces, so at a narrow width it is wider than the box
                      it is in. */}
                  <p className="mt-1 break-words font-medium text-[var(--foreground)]">{customerName}</p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Email</p>
                  <p className="mt-1 break-all font-medium text-[var(--foreground)]">
                    {booking.customer.user.email}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Phone</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.customer.user.phone ?? "Not provided"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Address</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.customer.address ?? "No customer address saved"}
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-[24px] bg-[var(--surface-muted)] p-5">
                <div>
                  <p className="text-sm text-[var(--muted)]">Event type</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {formatEnum(booking.eventType)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Event date</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {formatEventDate(booking.eventDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Location</p>
                  <p className="mt-1 flex items-center gap-2 font-medium text-[var(--foreground)]">
                    <MapPin className="h-4 w-4 text-[var(--brand-dark)]" />
                    {booking.location}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Guest count</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.guestCount} guests
                  </p>
                </div>
                <div>
                  {/* Only per-day services read this, but an approver quoting
                      crockery for the whole function needs to see it. */}
                  <p className="text-sm text-[var(--muted)]">Duration</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.durationDays} day{booking.durationDays === 1 ? "" : "s"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[var(--muted)]">Notes</p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {booking.notes?.trim() || "No notes added for this request"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Package and services</CardTitle>
              <CardDescription>
                Package selection plus all individually priced booking services.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface-muted)] p-5">
                <p className="text-sm text-[var(--muted)]">Selected package</p>
                <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                  {booking.package?.name ?? booking.packageNameSnapshot ?? "Custom service booking"}
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {booking.package?.description ?? "No package was attached to this booking."}
                </p>
              </div>

              {packageServices.length > 0 ? (
                <div className="grid gap-3">
                  <p className="text-sm font-medium text-[var(--foreground)]">Included package services</p>
                  {packageServices.map((item) => (
                    <div
                      key={item.serviceId}
                      className="flex flex-col gap-3 rounded-[20px] border sm:flex-row sm:items-center sm:justify-between border-[var(--line)] px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.service.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {item.service.description ?? "Standard package service"}
                        </p>
                      </div>
                      <Badge>Qty {item.quantity}</Badge>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3">
                <p className="text-sm font-medium text-[var(--foreground)]">Booked service lines</p>
                {booking.bookingServices.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                    No service lines are attached to this booking.
                  </div>
                ) : (
                  booking.bookingServices.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-[20px] border border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.service.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          Unit price {formatCurrency(item.unitPrice)} each
                        </p>
                      </div>
                      <div className="text-sm text-right text-[var(--muted)]">
                        <p>Quantity {item.quantity}</p>
                        <p className="font-medium text-[var(--foreground)]">
                          {formatCurrency(item.totalPrice)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Operational readiness</CardTitle>
              <CardDescription>
                A fast summary for inventory, staff, invoice coverage, and calendar connection.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                {
                  label: "Booking status",
                  value: formatEnum(booking.status),
                },
                {
                  label: "Inventory reserved",
                  value:
                    totalReservedInventory > 0
                      ? `${totalReservedInventory} items across ${booking.bookingInventory.length} categories`
                      : "No inventory reserved yet",
                },
                {
                  label: "Team assignment",
                  value:
                    totalAssignedStaff > 0
                      ? `${totalAssignedStaff} member${totalAssignedStaff === 1 ? "" : "s"} assigned`
                      : "No staff assigned yet",
                },
                {
                  label: "Calendar event",
                  value: booking.event ? "Linked to event calendar" : "No event record yet",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[22px] border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm text-[var(--muted)]">{item.label}</p>
                  <p className="mt-2 font-medium text-[var(--foreground)]">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory allocation</CardTitle>
              <CardDescription>
                Reserved stock attached to this booking and any low-availability signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {booking.bookingInventory.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  No inventory has been reserved for this booking yet.
                </div>
              ) : (
                booking.bookingInventory.map((item) => {
                  const isLow = item.inventory.availableQuantity <= item.inventory.reorderLevel;

                  return (
                    <div
                      key={item.id}
                      className="rounded-[20px] border border-[var(--line)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--foreground)]">
                            {item.inventory.name}
                          </p>
                          <p className="text-sm text-[var(--muted)]">
                            {formatEnum(item.inventory.category)}
                          </p>
                        </div>
                        <Badge className={cn(isLow && "bg-[var(--danger-soft)] text-[var(--danger-text)]")}>
                          Reserved {item.quantity}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        Available now {item.inventory.availableQuantity} of{" "}
                        {item.inventory.totalQuantity}
                        {isLow ? " • below reorder threshold" : ""}
                      </p>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Staff assignment</CardTitle>
              <CardDescription>
                {teamReleased
                  ? "This event is over. The team below is the record of who worked it, and they are free for other events."
                  : "Assigned team members and their current role for the booking."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {booking.bookingStaff.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  No staff members have been attached to this booking yet.
                </div>
              ) : (
                booking.bookingStaff.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="rounded-[20px] border border-[var(--line)] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {assignment.staff.user.firstName} {assignment.staff.user.lastName ?? ""}
                        </p>
                        <p className="text-sm text-[var(--muted)]">
                          {formatEnum(assignment.staff.staffType)}
                        </p>
                      </div>
                      {/*
                        The Remove button is only offered while the team is
                        still booked. Once the event is over the row is history,
                        and a button for un-assigning somebody from work that
                        has already happened is an invitation to erase the
                        record of who did it.
                      */}
                      <div className="flex items-center gap-2"><Badge>{formatDate(assignment.assignedAt)}</Badge>{teamReleased ? <Badge className="bg-[var(--surface-strong)] text-[var(--muted)]">Released</Badge> : operationsLocked ? <Badge className="bg-[var(--surface-strong)] text-[var(--muted)]">Locked</Badge> : <ActionForm action={unassignStaffFormAction}><input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="assignmentId" value={assignment.id} /><Button type="submit" size="sm" variant="outline">Remove</Button></ActionForm>}</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Calendar and audit</CardTitle>
              <CardDescription>Timeline and system metadata linked to this booking record.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="rounded-[20px] bg-[var(--surface-muted)] p-4">
                <p className="text-[var(--muted)]">Calendar event</p>
                <p className="mt-1 font-medium text-[var(--foreground)]">
                  {booking.event?.title ?? "No event created yet"}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {booking.event
                    ? `${formatDate(booking.event.startDate)} to ${formatDate(booking.event.endDate)}`
                    : "Create an event record when operations planning begins."}
                </p>
              </div>
              <div className="rounded-[20px] bg-[var(--surface-muted)] p-4">
                <p className="text-[var(--muted)]">Record timestamps</p>
                <p className="mt-1 text-[var(--foreground)]">Created {formatDate(booking.createdAt)}</p>
                <p className="mt-1 text-[var(--foreground)]">Updated {formatDate(booking.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
