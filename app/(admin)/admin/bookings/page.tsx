import Link from "next/link";
import { BookingStatus, EventType } from "@prisma/client";
import { CalendarDays, Clock3, IndianRupee, Receipt, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminBookings } from "@/lib/admin-bookings";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const statusOptions = [
  { label: "All bookings", value: "all" },
  ...Object.values(BookingStatus).map((status) => ({
    label: status.replace("_", " "),
    value: status,
  })),
] as const;

function getStatusBadgeClass(status: BookingStatus) {
  switch (status) {
    case BookingStatus.APPROVED:
      return "bg-emerald-100 text-emerald-800";
    case BookingStatus.PREPARING:
      return "bg-blue-100 text-blue-800";
    case BookingStatus.COMPLETED:
      return "bg-stone-900 text-stone-50";
    case BookingStatus.CANCELLED:
    case BookingStatus.REJECTED:
      return "bg-red-100 text-red-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function formatEventType(eventType: EventType) {
  return eventType.charAt(0) + eventType.slice(1).toLowerCase();
}

function formatStatusLabel(status: BookingStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = Object.values(BookingStatus).includes(status as BookingStatus)
    ? (status as BookingStatus)
    : undefined;
  const { bookings, metrics } = await getAdminBookings(activeStatus);

  const totalRevenue = bookings.reduce((sum, booking) => sum + Number(booking.totalAmount), 0);
  const amountCollected = bookings.reduce((sum, booking) => sum + Number(booking.paidAmount), 0);
  const today = new Date();
  const highlightedEvents = bookings
    .filter((booking) => new Date(booking.eventDate) >= today)
    .slice(0, 4);

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-6 shadow-[0_20px_55px_rgba(61,40,14,0.08)] sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(211,138,22,0.18),transparent_30%),linear-gradient(140deg,rgba(255,255,255,0.45),transparent_60%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <Badge className="bg-[rgba(211,138,22,0.14)] text-[var(--brand-dark)]">
              Booking Operations
            </Badge>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-5xl">
                Booking pipeline and event readiness
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
                Review incoming requests, monitor upcoming events, and keep payment visibility in
                one place for the operations team.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-[rgba(53,41,26,0.08)] bg-[rgba(255,255,255,0.78)] px-5 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Collected</p>
              <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                {formatCurrency(amountCollected)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">Across current visible bookings</p>
            </div>
            <div className="rounded-[24px] border border-[rgba(53,41,26,0.08)] bg-[rgba(35,27,21,0.95)] px-5 py-4 text-white shadow-sm">
              <p className="text-xs uppercase tracking-[0.24em] text-white/60">Projected value</p>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(totalRevenue)}</p>
              <p className="mt-1 text-sm text-white/70">Filtered booking portfolio total</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Total bookings",
            value: metrics.totalBookings,
            detail: "All requests and confirmed events",
            icon: Ticket,
          },
          {
            label: "Pending review",
            value: metrics.pendingBookings,
            detail: "Awaiting approval or rejection",
            icon: Clock3,
          },
          {
            label: "Approved",
            value: metrics.approvedBookings,
            detail: "Ready for operations handoff",
            icon: CalendarDays,
          },
          {
            label: "Upcoming events",
            value: metrics.upcomingEvents,
            detail: "Approved or preparing",
            icon: Receipt,
          },
          {
            label: "Balance due",
            value: metrics.overdueBalances,
            detail: "Bookings with unpaid amount",
            icon: IndianRupee,
          },
        ].map(({ label, value, detail, icon: Icon }) => (
          <Card key={label} className="bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)]">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-[var(--muted)]">{label}</p>
                  <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{value}</p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(211,138,22,0.14)] text-[var(--brand-dark)]">
                  <Icon className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="overflow-hidden bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)]">
          <CardHeader className="flex flex-col gap-4 border-b border-stone-100 pb-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-2xl">Bookings</CardTitle>
                <CardDescription>
                  Customer, event, payment, and invoice visibility for every booking.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((option) => {
                  const isActive =
                    (option.value === "all" && !activeStatus) || option.value === activeStatus;

                  return (
                    <Link
                      key={option.value}
                      href={
                        option.value === "all"
                          ? "/admin/bookings"
                          : `/admin/bookings?status=${option.value}`
                      }
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm font-medium transition",
                        isActive
                          ? "border-amber-400 bg-amber-100 text-amber-900"
                          : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
                      )}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {bookings.length === 0 ? (
              <div className="p-10 text-center">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  No bookings found
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Try a different status filter or wait for a new booking request to arrive.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead>Financials</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((booking) => (
                      <TableRow key={booking.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-stone-900">
                              {booking.customer.user.firstName} {booking.customer.user.lastName ?? ""}
                            </p>
                            <p className="text-sm text-stone-500">{booking.customer.user.email}</p>
                            <p className="text-sm text-stone-500">
                              {booking.customer.user.phone ?? "Phone not added"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-stone-900">
                              {formatEventType(booking.eventType)}
                            </p>
                            <p className="text-sm text-stone-500">{booking.location}</p>
                            <p className="text-sm text-stone-500">{booking.guestCount} guests</p>
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(booking.eventDate)}</TableCell>
                        <TableCell>{booking.package?.name ?? "Custom services"}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-stone-900">
                              {formatCurrency(booking.totalAmount)}
                            </p>
                            <p className="text-sm text-stone-500">
                              Paid {formatCurrency(booking.paidAmount)}
                            </p>
                            <p className="text-sm text-stone-500">
                              Balance {formatCurrency(booking.balanceAmount)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusBadgeClass(booking.status)}>
                            {formatStatusLabel(booking.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(booking.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/admin/bookings/${booking.id}`}>
                              <Button size="sm" variant="secondary">
                                View
                              </Button>
                            </Link>
                            {booking.invoice ? (
                              <Link href={`/api/invoices/${booking.invoice.id}/download`}>
                                <Button size="sm" variant="outline">
                                  Invoice
                                </Button>
                              </Link>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="bg-[linear-gradient(180deg,rgba(37,28,22,0.98),rgba(20,16,12,0.98))] text-white shadow-[0_24px_60px_rgba(28,20,12,0.32)]">
            <CardHeader>
              <CardTitle className="text-white">Upcoming spotlight</CardTitle>
              <CardDescription className="text-white/65">
                Next scheduled bookings from the current filter.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {highlightedEvents.length === 0 ? (
                <p className="text-sm text-white/70">No upcoming events in this selection yet.</p>
              ) : (
                highlightedEvents.map((booking) => (
                  <div
                    key={booking.id}
                    className="rounded-[22px] border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">
                        {booking.customer.user.firstName} {booking.customer.user.lastName ?? ""}
                      </p>
                      <Badge className="bg-white/10 text-white">
                        {formatStatusLabel(booking.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-white/70">
                      {formatEventType(booking.eventType)} at {booking.location}
                    </p>
                    <p className="mt-1 text-sm text-white/55">{formatDate(booking.eventDate)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What each row covers</CardTitle>
              <CardDescription>
                This view surfaces the exact admin data the booking workflow depends on.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-[var(--muted)]">
              <div className="rounded-[22px] bg-stone-50 p-4">
                Customer identity, contact info, and event basics are grouped together for quick
                approval review.
              </div>
              <div className="rounded-[22px] bg-stone-50 p-4">
                Financial columns show total, paid, and balance amounts pulled directly from the
                booking record.
              </div>
              <div className="rounded-[22px] bg-stone-50 p-4">
                Invoice access appears only when an invoice has already been created for that
                booking.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
