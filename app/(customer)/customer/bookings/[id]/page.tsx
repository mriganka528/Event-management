import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { ArrowLeft, CalendarDays, Download, MapPin, Receipt, Users } from "lucide-react";
import { getBookingByIdForCustomer } from "@/lib/bookings";
import { requireCustomerPage } from "@/lib/route-guards";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RazorpayCheckout } from "@/components/payments/razorpay-checkout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking details", robots: { index: false, follow: false, nocache: true } };

export default async function CustomerBookingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCustomerPage();
  const { id } = await params;
  const booking = user.customerProfile ? await getBookingByIdForCustomer(id, user.customerProfile.id) : null;
  if (!booking) notFound();

  return (
    <div className="space-y-7">
      <Link href="/customer/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft className="h-4 w-4" />Back to dashboard</Link>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Booking details</p><h1 className="mt-2 text-4xl font-semibold">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</h1><p className="mt-2 text-[var(--muted)]">Reference {booking.id.slice(0, 8).toUpperCase()}</p></div><Badge className={booking.status === BookingStatus.PENDING ? "bg-amber-100 text-amber-800" : booking.status === BookingStatus.APPROVED ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-700"}>{booking.status.toLowerCase()}</Badge></div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Event plan</CardTitle><CardDescription>Your submitted event details.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Date</p><p className="mt-1 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-amber-700" />{formatDate(booking.eventDate)}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Location</p><p className="mt-1 flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-amber-700" />{booking.location}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Guests</p><p className="mt-1 flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-amber-700" />{booking.guestCount}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Package</p><p className="mt-1 font-semibold">{booking.package?.name ?? booking.packageNameSnapshot ?? "Custom services"}</p></div>{booking.notes ? <div className="rounded-2xl bg-stone-50 p-4 sm:col-span-2"><p className="text-sm text-[var(--muted)]">Notes</p><p className="mt-1 whitespace-pre-wrap">{booking.notes}</p></div> : null}</CardContent></Card>
          <Card><CardHeader><CardTitle>Services</CardTitle><CardDescription>Everything included in your request.</CardDescription></CardHeader><CardContent className="grid gap-3">{booking.bookingServices.length === 0 ? <p className="text-sm text-[var(--muted)]">No add-on services selected.</p> : booking.bookingServices.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-2xl border sm:flex-row sm:items-center sm:justify-between border-stone-100 p-4"><div><p className="font-semibold">{item.service.name}</p><p className="text-sm text-[var(--muted)]">Quantity {item.quantity} · {formatCurrency(item.unitPrice)} each</p></div><p className="font-semibold">{formatCurrency(item.totalPrice)}</p></div>)}</CardContent></Card>
        </div>
        <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-amber-700" />Payment summary</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-[var(--muted)]">Subtotal</span><span>{formatCurrency(booking.subtotal)}</span></div><div className="flex justify-between"><span className="text-[var(--muted)]">Tax</span><span>{formatCurrency(booking.taxAmount)}</span></div><div className="flex justify-between border-t border-stone-100 pt-3 text-base font-semibold"><span>Total</span><span>{formatCurrency(booking.totalAmount)}</span></div><div className="flex justify-between text-emerald-700"><span>Paid</span><span>{formatCurrency(booking.paidAmount)}</span></div><div className="flex justify-between font-semibold"><span>Balance</span><span>{formatCurrency(booking.balanceAmount)}</span></div></div>{booking.invoice ? <Link href={`/api/invoices/${booking.invoice.id}/download`}><Button variant="outline" className="w-full"><Download className="mr-2 h-4 w-4" />Download invoice</Button></Link> : <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Your invoice will appear here once the team approves the booking.</p>}{["APPROVED", "PREPARING", "COMPLETED"].includes(booking.status) && Number(booking.balanceAmount) > 0 ? <RazorpayCheckout bookingId={booking.id} amount={Number(booking.balanceAmount)} /> : null}<p className="text-xs leading-5 text-[var(--muted)]">Pay securely online by Razorpay, or contact us if you need help with your event plan.</p></CardContent></Card>
      </div>
    </div>
  );
}
