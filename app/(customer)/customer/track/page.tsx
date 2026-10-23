import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatEventDate } from "@/lib/utils";
import { bookingStatusBadgeClass, bookingStatusLabel } from "@/lib/booking-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track your booking", robots: { index: false, follow: false, nocache: true } };

const STEPS = [
  { title: "Request received", detail: "Our team has your event details.", icon: CheckCircle2 },
  { title: "Review and quote", detail: "We check availability, stock, and timing.", icon: Clock3 },
  { title: "Confirmation", detail: "Once approved, your event is locked in.", icon: ShieldCheck },
];

export default async function TrackBookingPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || token.length < 20 || token.length > 200) notFound();
  const booking = await prisma.booking.findFirst({
    where: { publicToken: token, OR: [{ publicTokenExpiresAt: null }, { publicTokenExpiresAt: { gt: new Date() } }] },
    select: {
      id: true,
      status: true,
      eventType: true,
      eventDate: true,
      location: true,
      guestCount: true,
      totalAmount: true,
      createdAt: true,
      customer: { select: { user: { select: { firstName: true } } } },
      package: { select: { name: true } },
    },
  });
  if (!booking) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <Link href="/" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">Event Management</Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-dark)]">Booking status</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Hello, {booking.customer.user.firstName}.</h1>
        <p className="mt-3 text-[var(--muted)]">Here is the latest update for your event request.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-2xl">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</CardTitle>
              <CardDescription className="mt-1">Reference {booking.id.slice(0, 8).toUpperCase()}</CardDescription>
            </div>
            <Badge className={`shrink-0 ${bookingStatusBadgeClass(booking.status)}`}>{bookingStatusLabel(booking.status)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {[
            { label: "Date", value: formatEventDate(booking.eventDate), icon: CalendarDays },
            { label: "Location", value: booking.location, icon: MapPin },
            { label: "Guests", value: booking.guestCount, icon: Users },
            { label: "Package", value: booking.package?.name ?? "Custom services", icon: CheckCircle2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="min-w-0 rounded-2xl bg-[var(--surface-muted)] p-4">
              <p className="text-sm text-[var(--muted)]">{label}</p>
              {/*
                The icon is a fixed-width sibling of the value, so the value
                needs its own element to be able to break. A venue address is a
                free-text field and is the value that runs long.
              */}
              <p className="mt-1 flex items-start gap-2 font-semibold">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-dark)]" />
                <span className="min-w-0 break-words">{value}</span>
              </p>
            </div>
          ))}
          <div className="rounded-2xl bg-[var(--surface-muted)] p-4 sm:col-span-2">
            <p className="text-sm text-[var(--muted)]">Requested total</p>
            <p className="mt-1 break-words text-xl font-semibold">{formatCurrency(booking.totalAmount)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Submitted {formatDate(booking.createdAt)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happens next</CardTitle>
          <CardDescription>The team moves your request through these steps.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {STEPS.map(({ title, detail, icon: Icon }, index) => (
            <div key={title} className="flex items-start gap-3 rounded-2xl border border-[var(--line)] p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="font-semibold">Step {index + 1} · {title}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
