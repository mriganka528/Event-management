import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatus } from "@prisma/client";
import { ArrowRight, Bell, CalendarDays, IndianRupee, MapPin, PlusCircle, Receipt, Ticket, Users, Wallet } from "lucide-react";
import { getCustomerDashboardData } from "@/lib/dashboard";
import { requireCustomerPage } from "@/lib/route-guards";
import { formatCurrency, formatDate, formatEventRange } from "@/lib/utils";
import { notificationHref } from "@/lib/notification-links";
import { paymentRequestOutstanding } from "@/lib/payment-requests";
import { bookingStatusBadgeClass, bookingStatusLabel } from "@/lib/booking-status";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoiceViewLink } from "@/components/invoices/invoice-view-link";
import { PaymentHistory } from "@/components/payments/payment-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { cancelBookingFormAction } from "@/lib/form-actions";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My dashboard", robots: { index: false, follow: false, nocache: true } };

export default async function CustomerDashboardPage() {
  const user = await requireCustomerPage();
  const customer = user.customerProfile ? await getCustomerDashboardData(user.id) : null;
  const bookings = customer?.bookings ?? [];
  const terminalStatuses: BookingStatus[] = [BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.COMPLETED];
  const activeBookings = bookings.filter((booking) => !terminalStatuses.includes(booking.status));
  const totalSpent = bookings.reduce((sum, booking) => sum + Number(booking.paidAmount), 0);
  const outstanding = bookings
    .filter((booking) => booking.status !== BookingStatus.CANCELLED && booking.status !== BookingStatus.REJECTED)
    .reduce((sum, booking) => sum + Number(booking.balanceAmount), 0);
  // Only a request that is still a request can be withdrawn by the customer.
  // Approval is the point the team committed a date, stock, and staff.
  const cancellable = bookings.filter((booking) => booking.status === BookingStatus.PENDING && Number(booking.paidAmount) === 0);
  const requestedTotal = bookings.reduce((sum, booking) => {
    const due = paymentRequestOutstanding({
      paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
      paidAmount: booking.paidAmount,
      balanceAmount: booking.balanceAmount,
    });
    return sum + (due ?? 0);
  }, 0);
  const paymentHistory = bookings
    .flatMap((booking) =>
      booking.payments.map((payment) => ({
        ...payment,
        bookingLabel: `${booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} · ${formatEventRange(booking.eventDate, booking.durationDays)}`,
        bookingHref: `/customer/bookings/${booking.id}`,
      })),
    )
    .sort((a, b) => new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime());

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Customer dashboard</p>
          {/*
            The scale steps down on a phone. A 4xl greeting with a long first
            name does not fit a 320px screen, and the overflow was pushing the
            rest of the page sideways.
          */}
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">Welcome, {user.firstName}.</h1>
          <p className="text-[var(--muted)]">Keep every event, payment, and next step in one place.</p>
        </div>
        <Link href="/customer/bookings/new" className="w-full shrink-0 sm:w-auto">
          <Button className="w-full sm:w-auto"><PlusCircle className="mr-2 h-4 w-4" />Plan another event</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "All bookings", value: bookings.length, icon: Ticket },
          { label: "Active events", value: activeBookings.length, icon: CalendarDays },
          { label: "Outstanding balance", value: formatCurrency(outstanding), icon: IndianRupee },
          { label: "Payment requested", value: formatCurrency(requestedTotal), icon: Wallet },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--muted)]">{label}</p>
                  {/*
                    A rupee amount is a number the customer is meant to read
                    exactly, so it wraps rather than truncating. `truncate`
                    would quietly turn ₹1,00,300 into "₹1,00,3…".
                  */}
                  <p className="mt-2 break-words text-2xl font-semibold leading-tight">{value}</p>
                </div>
                <span className="shrink-0 rounded-2xl bg-[var(--brand-soft)] p-3 text-[var(--brand-dark)]"><Icon className="h-5 w-5" /></span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <CardTitle className="text-2xl">Your bookings</CardTitle>
            <CardDescription>Requests and confirmed event plans.</CardDescription>
          </div>
          <Badge className="shrink-0">{bookings.length} total</Badge>
        </CardHeader>
        <CardContent>
          {bookings.length === 0 ? (
            <EmptyState
              title="No bookings yet"
              description="Tell us about your first event and our team will prepare a proposal."
              action={<Link href="/customer/bookings/new"><Button>Start a booking request</Button></Link>}
            />
          ) : (
            <div className="grid gap-4">
              {bookings.map((booking) => {
                const requested = paymentRequestOutstanding({
                  paymentRequestTargetAmount: booking.paymentRequestTargetAmount,
                  paidAmount: booking.paidAmount,
                  balanceAmount: booking.balanceAmount,
                });
                return (
                  <div
                    key={booking.id}
                    className="rounded-2xl border border-[var(--line)] p-5 transition hover:border-[var(--brand)]"
                  >
                    <Link href={`/customer/bookings/${booking.id}`} className="group block">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <p className="text-lg font-semibold">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</p>
                            <Badge className={bookingStatusBadgeClass(booking.status)}>{bookingStatusLabel(booking.status)}</Badge>
                            {requested !== null ? (
                              <Badge className="bg-[var(--warning-soft)] text-[var(--warning-text)]">Pay {formatCurrency(requested)}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
                            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 shrink-0" />{formatEventRange(booking.eventDate, booking.durationDays)}</span>
                            {/*
                              A venue address is a free-text field, so it is
                              the one value here that can be long. It breaks
                              rather than pushing the row wider than the card.
                            */}
                            <span className="inline-flex min-w-0 items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{booking.location}</span></span>
                            <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 shrink-0" />{booking.guestCount} guests</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-5 sm:shrink-0 sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="font-semibold">{formatCurrency(booking.totalAmount)}</p>
                            <p className="text-sm text-[var(--muted)]">Balance {formatCurrency(booking.balanceAmount)}</p>
                          </div>
                          <ArrowRight className="h-5 w-5 shrink-0 text-[var(--muted)] transition group-hover:translate-x-1" />
                        </div>
                      </div>
                    </Link>
                    {booking.invoice || requested !== null ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
                        {booking.invoice ? (
                          <>
                            <InvoiceViewLink href={`/customer/invoices/${booking.invoice.id}`} />
                            <InvoiceDownloadButton invoiceId={booking.invoice.id} />
                          </>
                        ) : null}
                        {requested !== null ? (
                          <Link href={`/customer/bookings/${booking.id}`}>
                            <Button size="sm"><Receipt className="mr-2 h-4 w-4" />Pay {formatCurrency(requested)}</Button>
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Wallet className="h-5 w-5 shrink-0 text-[var(--brand-dark)]" />
              Payment history
            </CardTitle>
            <CardDescription>Advances, cash declarations, and final settlements across your bookings.</CardDescription>
          </div>
          <Badge className="shrink-0">{paymentHistory.length} payment{paymentHistory.length === 1 ? "" : "s"}</Badge>
        </CardHeader>
        <CardContent>
          <PaymentHistory
            payments={paymentHistory}
            showBooking
            emptyMessage="No payments have been recorded yet. Payment history will appear here after your first advance or settlement."
          />
        </CardContent>
      </Card>

      {customer?.user.notifications && customer.user.notifications.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-[var(--brand-dark)]" />Recent updates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {customer.user.notifications.map((notification) => (
              <div key={notification.id} className="rounded-2xl bg-[var(--surface-muted)] p-4">
                {/*
                  The title and the timestamp sit side by side on a wide screen
                  and stack on a narrow one. A title and a date on one line
                  squeezed them both into illegibility.
                */}
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <p className="min-w-0 break-words font-medium">{notification.title}</p>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{formatDate(notification.createdAt)}</span>
                </div>
                <p className="mt-1 break-words text-sm text-[var(--muted)]">{notification.message}</p>
                {/* The update is about a particular booking, so it links there
                    rather than leaving the customer to find it. */}
                <Link href={notificationHref(notification.type, "CUSTOMER", notification.href ?? undefined)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-dark)] hover:underline">
                  View details <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {cancellable.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Need to make a change?</CardTitle>
            <CardDescription>
              You can cancel while a request is awaiting review. Once the team approves it, they have already reserved the date, stock, and staff — contact them to change it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {cancellable.map((booking) => (
              <div key={booking.id} className="flex flex-col gap-3 rounded-2xl bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-medium">{booking.eventType.toLowerCase()} · {formatEventRange(booking.eventDate, booking.durationDays)}</p>
                  <p className="mt-1 break-words text-sm text-[var(--muted)]">{booking.location}</p>
                </div>
                <ActionForm action={cancelBookingFormAction} className="w-full shrink-0 sm:w-auto">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto">Cancel request</Button>
                </ActionForm>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        Total paid across your bookings: <span className="font-semibold text-[var(--foreground)]">{formatCurrency(totalSpent)}</span>
      </p>
    </div>
  );
}
