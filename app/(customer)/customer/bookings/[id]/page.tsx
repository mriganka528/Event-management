import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { ArrowLeft, CalendarDays, MapPin, Receipt, Users, XCircle } from "lucide-react";
import { getBookingByIdForCustomer } from "@/lib/bookings";
import { requireCustomerPage } from "@/lib/route-guards";
import { formatCurrency, formatEventRange } from "@/lib/utils";
import { PAYMENT_REQUEST_LABEL, paymentAmountOptions } from "@/lib/payment-requests";
import { bookingStatusBadgeClass, bookingStatusLabel } from "@/lib/booking-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RazorpayCheckout } from "@/components/payments/razorpay-checkout";
import { PaymentHistory } from "@/components/payments/payment-history";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoiceViewLink } from "@/components/invoices/invoice-view-link";
import { ActionForm } from "@/components/forms/action-form";
import { cancelBookingFormAction } from "@/lib/form-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking details", robots: { index: false, follow: false, nocache: true } };

export default async function CustomerBookingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCustomerPage();
  const { id } = await params;
  const booking = user.customerProfile ? await getBookingByIdForCustomer(id, user.customerProfile.id) : null;
  if (!booking) notFound();

  const payment = paymentAmountOptions({
    paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
    paidAmount: booking.paidAmount,
    balanceAmount: booking.balanceAmount,
  });
  const payable = ["APPROVED", "PREPARING", "COMPLETED"].includes(booking.status) && payment.balance > 0;
  const pendingCash = booking.payments.find((item) => item.status === "PENDING" && item.method === "CASH") ?? null;

  return (
    <div className="space-y-7">
      <Link href="/customer/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
        <ArrowLeft className="h-4 w-4" />Back to dashboard
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Booking details</p>
          {/*
            The scale steps down on a phone. A 4xl event name ran past the
            edge of a narrow screen.
          */}
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</h1>
          <p className="mt-2 text-[var(--muted)]">Reference {booking.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <Badge className={`shrink-0 ${bookingStatusBadgeClass(booking.status)}`}>{bookingStatusLabel(booking.status)}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Event plan</CardTitle>
              <CardDescription>Your submitted event details.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {[
                // The range, not just the first day. A customer who booked
                // three days needs to see the three days.
                { label: "Date", value: formatEventRange(booking.eventDate, booking.durationDays), icon: CalendarDays },
                { label: "Location", value: booking.location, icon: MapPin },
                { label: "Guests", value: booking.guestCount, icon: Users },
                { label: "Duration", value: `${booking.durationDays} day${booking.durationDays === 1 ? "" : "s"}`, icon: CalendarDays },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="min-w-0 rounded-2xl bg-[var(--surface-muted)] p-4">
                  <p className="text-sm text-[var(--muted)]">{label}</p>
                  {/*
                    The icon is a fixed-width sibling of the value, so the value
                    needs its own element to be able to break. A venue address
                    is a free-text field and is the value that runs long.
                  */}
                  <p className="mt-1 flex items-start gap-2 font-semibold">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-dark)]" />
                    <span className="min-w-0 break-words">{value}</span>
                  </p>
                </div>
              ))}
              <div className="rounded-2xl bg-[var(--surface-muted)] p-4">
                <p className="text-sm text-[var(--muted)]">Package</p>
                <p className="mt-1 font-semibold">{booking.package?.name ?? booking.packageNameSnapshot ?? "Custom services"}</p>
              </div>
              {booking.notes ? (
                <div className="rounded-2xl bg-[var(--surface-muted)] p-4 sm:col-span-2">
                  <p className="text-sm text-[var(--muted)]">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{booking.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Services</CardTitle>
              <CardDescription>Everything included in your request.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {booking.bookingServices.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No add-on services selected.</p>
              ) : (
                booking.bookingServices.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-semibold">{item.service.name}</p>
                      <p className="text-sm text-[var(--muted)]">Quantity {item.quantity} · {formatCurrency(item.unitPrice)} each</p>
                    </div>
                    <p className="shrink-0 font-semibold">{formatCurrency(item.totalPrice)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Need to make a change?</CardTitle>
              <CardDescription>
                {booking.status === BookingStatus.PENDING
                  ? "You can cancel this request until the team reviews it."
                  : "The team has already reviewed this booking, so changes are handled by them."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {booking.status === BookingStatus.PENDING ? (
                <div className="flex flex-col gap-3 rounded-2xl bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[var(--muted)]">Cancelling frees the date immediately and notifies our team.</p>
                  <ActionForm action={cancelBookingFormAction} className="w-full shrink-0 sm:w-auto">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto"><XCircle className="mr-2 h-4 w-4" />Cancel request</Button>
                  </ActionForm>
                </div>
              ) : (
                <p className="rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
                  Contact us with reference <span className="font-semibold text-[var(--foreground)]">{booking.id.slice(0, 8).toUpperCase()}</span> and we will take care of it.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 shrink-0 text-[var(--brand-dark)]" />Payment summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
              The label and the amount are two flex items. The amount needs to
              be allowed to shrink and wrap, or a large total pushes the label
              off the left edge on a phone.
            */}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Subtotal</span><span className="min-w-0 break-words text-right">{formatCurrency(booking.subtotal)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Tax</span><span className="min-w-0 break-words text-right">{formatCurrency(booking.taxAmount)}</span></div>
              <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-3 text-base font-semibold"><span>Total</span><span className="min-w-0 break-words text-right">{formatCurrency(booking.totalAmount)}</span></div>
              <div className="flex justify-between gap-3 text-[var(--success-text)]"><span>Paid</span><span className="min-w-0 break-words text-right">{formatCurrency(booking.paidAmount)}</span></div>
              <div className="flex justify-between gap-3 font-semibold"><span>Balance</span><span className="min-w-0 break-words text-right">{formatCurrency(booking.balanceAmount)}</span></div>
            </div>

            {payable && payment.requested !== null && booking.paymentRequestMode ? (
              <div className="rounded-2xl border border-[var(--brand)]/40 bg-[var(--brand-softer)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-dark)]">Payment requested</p>
                <p className="mt-1 break-words text-2xl font-semibold text-[var(--foreground)]">{formatCurrency(payment.requested)}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {PAYMENT_REQUEST_LABEL[booking.paymentRequestMode]} requested by our team. Pay the requested amount now, or settle the full balance.
                </p>
              </div>
            ) : null}

            {booking.invoice ? (
              <div className="grid gap-2">
                <InvoiceViewLink href={`/customer/invoices/${booking.invoice.id}`} variant="outline" size="default" className="w-full" />
                <InvoiceDownloadButton invoiceId={booking.invoice.id} label="Download PDF" className="block [&>button]:w-full" />
              </div>
            ) : (
              <p className="rounded-2xl bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning-text)]">Your invoice will appear here once the team approves the booking.</p>
            )}

            {pendingCash ? (
              <div className="rounded-2xl border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning-text)]">
                <p className="font-semibold">Cash payment awaiting confirmation</p>
                <p className="mt-1">
                  You declared {formatCurrency(pendingCash.amount)} in cash. This does not count as paid until our team approves it.
                </p>
              </div>
            ) : null}

            {payable ? (
              <RazorpayCheckout
                bookingId={booking.id}
                amount={payment.balance}
                requestedAmount={payment.requested}
                requestedLabel={booking.paymentRequestMode ? PAYMENT_REQUEST_LABEL[booking.paymentRequestMode] : null}
                pendingCashAmount={pendingCash ? Number(pendingCash.amount) : null}
              />
            ) : null}

            <p className="text-xs leading-5 text-[var(--muted)]">
              {payable
                ? "Pay securely online by Razorpay, or contact us if you need help with your event plan."
                : "Payments open once the team approves your booking."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Every advance, cash declaration, and settlement recorded for this booking.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentHistory
            payments={booking.payments}
            emptyMessage="No payments have been recorded for this booking yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
