import { CalendarDays, Clock3, MapPin, Plus, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { getAdminBookings } from "@/lib/admin-bookings";
import { getAdminEvents } from "@/lib/admin-data";
import { createEventFormAction, deleteEventFormAction } from "@/lib/form-actions";
import { AdminSearch } from "@/components/admin/admin-search";
import { normalizeQuery, rowFilter, rowText } from "@/lib/search";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { EmptyState } from "@/components/forms/empty-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  description: "The event-day schedule attached to each approved booking.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await searchParams).q);
  const [events, bookingData] = await Promise.all([getAdminEvents(), getAdminBookings()]);
  // Rows stay in the DOM and non-matching ones are hidden, so the browser can
  // reveal them again with no round trip. The booking picker is a form control,
  // so it is deliberately not filtered.
  const visibility = rowFilter(query);
  const eventText = (event: (typeof events)[number]) =>
    rowText(event.title, event.location, event.booking.customer.user.firstName, event.booking.customer.user.lastName, event.booking.customer.user.email);
  const linked = new Set(events.map((event) => event.bookingId));
  const candidates = bookingData.bookings.filter((booking) => !linked.has(booking.id) && ["APPROVED", "PREPARING"].includes(booking.status));
  return (
    <main className="space-y-6">
      <AdminSearch
        label="Search events"
        placeholder="Search by event title, venue, or customer…"
      />
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Event operations</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Every event has a timeline.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Connect approved bookings to the operations calendar and keep setup teams aligned on timing and location.</p></section>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]"><Card><CardHeader><CardTitle className="text-2xl">Event calendar records</CardTitle><CardDescription>Upcoming and past connected events.</CardDescription></CardHeader><CardContent>{events.length === 0 ? <EmptyState title="No calendar events yet" description="Connect a booking to start building the operations schedule." /> : <div className="grid gap-3">{events.map((event) => <div key={event.id} data-row-id={event.id} data-row-text={eventText(event)} style={visibility(eventText(event))} className="flex flex-col gap-3 rounded-2xl border border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><span className="rounded-2xl bg-amber-100 p-3 text-amber-800"><CalendarDays className="h-5 w-5" /></span><div><p className="font-semibold">{event.title}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted)]"><MapPin className="h-3.5 w-3.5" />{event.location}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Clock3 className="h-3.5 w-3.5" />{formatDate(event.startDate)} – {formatDate(event.endDate)}</p></div></div><div className="flex flex-wrap items-center gap-3"><Badge>{event.booking.status.toLowerCase()}</Badge><a href={`/admin/bookings/${event.bookingId}`} className="text-sm font-medium text-amber-800 hover:underline">View booking</a><ActionForm action={deleteEventFormAction}><input type="hidden" name="bookingId" value={event.bookingId} /><Button type="submit" size="sm" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Unlink</Button></ActionForm></div></div>)}</div>}</CardContent></Card><Card id="create-event"><CardHeader><CardTitle>Connect a booking</CardTitle><CardDescription>Create or update an event record manually.</CardDescription></CardHeader><CardContent>{candidates.length > 0 ? <ActionForm action={createEventFormAction} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Booking<Select name="bookingId" options={candidates.map((booking) => ({ label: `${booking.customer.user.firstName} ${booking.customer.user.lastName ?? ""} · ${booking.eventType.toLowerCase()}`, value: booking.id }))} /></label><label className="grid gap-2 text-sm font-medium">Event title<Input name="title" placeholder="Customer · Wedding" required /></label><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Starts<input name="startDate" type="datetime-local" required /></label><label className="grid gap-2 text-sm font-medium">Ends<input name="endDate" type="datetime-local" required /></label></div><label className="grid gap-2 text-sm font-medium">Location<Input name="location" placeholder="Venue" required /></label><SubmitButton><Plus className="mr-2 h-4 w-4" />Save event</SubmitButton></ActionForm> : <p className="text-sm text-[var(--muted)]">All eligible bookings are already connected.</p>}</CardContent></Card></div>
    </main>
  );
}
