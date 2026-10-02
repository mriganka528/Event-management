import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock3, MapPin, Users } from "lucide-react";
import { BookingStatus, StaffStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/route-guards";
import { updateOwnAvailabilityFormAction } from "@/lib/form-actions";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requireStaffPage();
  const staff = user.staffProfile;
  // Invited staff must activate their account before they can see assignments.
  if (staff && staff.status !== StaffStatus.ACTIVE) redirect("/staff/pending");
  const assignments = staff
    ? await prisma.bookingStaff.findMany({ where: { staffId: staff.id }, include: { booking: { include: { customer: { include: { user: true } }, package: true, event: true } } }, orderBy: { booking: { eventDate: "asc" } } }).catch(() => [])
    : [];
  const now = new Date();
  const upcoming = assignments.filter((assignment) => new Date(assignment.booking.eventDate) >= now && assignment.booking.status !== BookingStatus.CANCELLED && assignment.booking.status !== BookingStatus.REJECTED);
  const completed = assignments.filter((assignment) => assignment.booking.status === BookingStatus.COMPLETED);

  return <div className="space-y-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Field operations</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Your event day, simplified.</h1><p className="mt-3 text-[var(--muted)]">See assigned events, locations, timings, and your current availability.</p></div>{staff ? <ActionForm action={updateOwnAvailabilityFormAction}><input type="hidden" name="isAvailable" value={staff.isAvailable ? "false" : "true"} /><Button variant={staff.isAvailable ? "outline" : "default"}><span className={`mr-2 h-2 w-2 rounded-full ${staff.isAvailable ? "bg-emerald-500" : "bg-stone-400"}`} />{staff.isAvailable ? "Set unavailable" : "Set available"}</Button></ActionForm> : <p className="text-sm text-[var(--muted)]">You are viewing the staff workspace as an administrator.</p>}</div><section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Upcoming assignments</p><p className="mt-2 text-3xl font-semibold">{upcoming.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Completed events</p><p className="mt-2 text-3xl font-semibold">{completed.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-[var(--muted)]">Current status</p><p className="mt-2 flex items-center gap-2 text-lg font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${staff?.isAvailable ? "bg-emerald-500" : "bg-stone-400"}`} />{staff?.isAvailable ? "Available" : "Unavailable"}</p></CardContent></Card></section><Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-amber-700" />Assigned events</CardTitle><CardDescription>Your current and upcoming work orders.</CardDescription></CardHeader><CardContent>{assignments.length === 0 ? <EmptyState title="No assignments yet" description="An admin will assign you to an event when the schedule is ready." /> : <div className="grid gap-3">{assignments.map((assignment) => { const booking = assignment.booking; return <Link key={assignment.id} href={`mailto:${booking.customer.user.email}`} className="flex flex-col gap-4 rounded-2xl border border-stone-200 p-4 transition hover:border-amber-300 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><CalendarDays className="h-5 w-5" /></span><div><p className="font-semibold">{booking.customer.user.firstName} {booking.customer.user.lastName ?? ""} · {booking.eventType.toLowerCase()}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatDate(booking.eventDate)}</span><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{booking.location}</span><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{booking.guestCount} guests</span></div></div></div><div className="flex items-center gap-3"><Badge className={booking.status === BookingStatus.COMPLETED ? "bg-stone-900 text-white" : "bg-emerald-100 text-emerald-800"}>{booking.status.toLowerCase()}</Badge><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div></Link>; })}</div>}</CardContent></Card></div>;
}
