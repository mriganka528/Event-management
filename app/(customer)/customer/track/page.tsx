import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function TrackBookingPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || token.length < 20 || token.length > 200) notFound();
  const booking = await prisma.booking.findFirst({
    where: { publicToken: token, OR: [{ publicTokenExpiresAt: null }, { publicTokenExpiresAt: { gt: new Date() } }] },
    select: { id: true, status: true, eventType: true, eventDate: true, location: true, guestCount: true, totalAmount: true, createdAt: true, customer: { select: { user: { select: { firstName: true } } } }, package: { select: { name: true } } },
  });
  if (!booking) notFound();
  return <div className="mx-auto max-w-3xl space-y-7"><div><Link href="/" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">Event Management</Link><p className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Booking status</p><h1 className="mt-2 text-4xl font-semibold">Hello, {booking.customer.user.firstName}.</h1><p className="mt-3 text-[var(--muted)]">Here is the latest update for your event request.</p></div><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-2xl">{booking.eventType.charAt(0) + booking.eventType.slice(1).toLowerCase()} event</CardTitle><CardDescription className="mt-1">Reference {booking.id.slice(0, 8).toUpperCase()}</CardDescription></div><Badge className={booking.status === "PENDING" ? "bg-amber-100 text-amber-800" : booking.status === "APPROVED" || booking.status === "PREPARING" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-700"}>{booking.status.toLowerCase()}</Badge></div></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Date</p><p className="mt-1 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-amber-700" />{formatDate(booking.eventDate)}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Location</p><p className="mt-1 flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-amber-700" />{booking.location}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Guests</p><p className="mt-1 flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-amber-700" />{booking.guestCount}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-[var(--muted)]">Package</p><p className="mt-1 font-semibold">{booking.package?.name ?? "Custom services"}</p></div></CardContent></Card><Card className="bg-stone-900 text-white"><CardContent className="flex gap-3 p-5"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-semibold">What happens next?</p><p className="mt-1 text-sm text-white/70">Our team reviews every request personally. You will receive an email when the status or quote changes.</p><p className="mt-3 flex items-center gap-2 text-xs text-white/50"><Clock3 className="h-3.5 w-3.5" />Requested {formatDate(booking.createdAt)}</p></div></CardContent></Card><p className="flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]"><ShieldCheck className="h-4 w-4" />Keep this private link to yourself.</p></div>;
}
