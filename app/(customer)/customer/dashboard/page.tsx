import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatus } from "@prisma/client";
import { ArrowRight, Bell, CalendarDays, IndianRupee, MapPin, PlusCircle, Ticket, Users } from "lucide-react";
import { getCustomerDashboardData } from "@/lib/dashboard";
import { requireCustomerPage } from "@/lib/route-guards";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { cancelBookingFormAction } from "@/lib/form-actions";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer dashboard", robots: { index: false, follow: false, nocache: true } };

function statusClass(status: BookingStatus) {
  if (status === BookingStatus.APPROVED || status === BookingStatus.PREPARING) return "bg-emerald-100 text-emerald-800";
  if (status === BookingStatus.COMPLETED) return "bg-stone-900 text-white";
  if (status === BookingStatus.CANCELLED || status === BookingStatus.REJECTED) return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

export default async function CustomerDashboardPage() {
  const user = await requireCustomerPage();
  const customer = user.customerProfile ? await getCustomerDashboardData(user.id) : null;
  const bookings = customer?.bookings ?? [];
  const terminalStatuses: BookingStatus[] = [BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.COMPLETED];
  const activeBookings = bookings.filter((booking) => !terminalStatuses.includes(booking.status));
  const totalSpent = bookings.reduce((sum, booking) => sum + Number(booking.paidAmount), 0);
  const outstanding = bookings.filter((booking) => booking.status !== BookingStatus.CANCELLED && booking.status !== BookingStatus.REJECTED).reduce((sum, booking) => sum + Number(booking.balanceAmount), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Customer dashboard</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Welcome, {user.firstName}.</h1>
          <p className="text-[var(--muted)]">Keep every event, payment, and next step in one place.</p>
        </div>
        <Link href="/customer/bookings/new"><Button><PlusCircle className="mr-2 h-4 w-4" />Plan another event</Button></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[{ label: "All bookings", value: bookings.length, icon: Ticket }, { label: "Active events", value: activeBookings.length, icon: CalendarDays }, { label: "Outstanding balance", value: formatCurrency(outstanding), icon: IndianRupee }].map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><Icon className="h-5 w-5" /></span></div></CardContent></Card>)}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4"><div><CardTitle className="text-2xl">Your bookings</CardTitle><CardDescription>Requests and confirmed event plans.</CardDescription></div><Badge>{bookings.length} total</Badge></CardHeader>
        <CardContent>
          {bookings.length === 0 ? <EmptyState title="No bookings yet" description="Tell us about your first event and our team will prepare a proposal." action={<Link href="/customer/bookings/new"><Button>Start a booking request</Button></Link>} /> : <div className="grid gap-4">{bookings.map((booking) => <Link key={booking.id} href={`/customer/bookings/${booking.id}`} className="group rounded-2xl border border-stone-200 p-5 transition hover:border-amber-300 hover:bg-amber-50/40"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><p className="text-lg font-semibold">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</p><Badge className={statusClass(booking.status)}>{booking.status.toLowerCase()}</Badge></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(booking.eventDate)}</span><span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{booking.location}</span><span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" />{booking.guestCount} guests</span></div></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div className="text-left sm:text-right"><p className="font-semibold">{formatCurrency(booking.totalAmount)}</p><p className="text-sm text-[var(--muted)]">Balance {formatCurrency(booking.balanceAmount)}</p></div><ArrowRight className="h-5 w-5 text-[var(--muted)] transition group-hover:translate-x-1" /></div></div></Link>)}</div>}
        </CardContent>
      </Card>
      {customer?.user.notifications && customer.user.notifications.length > 0 ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-amber-700" />Recent updates</CardTitle></CardHeader><CardContent className="grid gap-3">{customer.user.notifications.slice(0, 5).map((notification) => <div key={notification.id} className="rounded-2xl bg-stone-50 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{notification.title}</p><span className="text-xs text-[var(--muted)]">{formatDate(notification.createdAt)}</span></div><p className="mt-1 text-sm text-[var(--muted)]">{notification.message}</p></div>)}</CardContent></Card> : null}
      {activeBookings.some((booking) => Number(booking.paidAmount) === 0) ? <Card><CardHeader><CardTitle>Need to make a change?</CardTitle><CardDescription>You can cancel an active request from here. Our team will be notified automatically.</CardDescription></CardHeader><CardContent className="grid gap-3">{activeBookings.filter((booking) => Number(booking.paidAmount) === 0).map((booking) => <div key={booking.id} className="flex flex-col gap-3 rounded-2xl bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{booking.eventType.toLowerCase()} · {formatDate(booking.eventDate)}</p><p className="mt-1 text-sm text-[var(--muted)]">{booking.location}</p></div><ActionForm action={cancelBookingFormAction}><input type="hidden" name="bookingId" value={booking.id} /><Button type="submit" size="sm" variant="outline">Cancel booking</Button></ActionForm></div>)}</CardContent></Card> : null}
      <p className="text-sm text-[var(--muted)]">Total paid across your bookings: <span className="font-semibold text-[var(--foreground)]">{formatCurrency(totalSpent)}</span></p>
    </div>
  );
}
