import Link from "next/link";
import type { Metadata } from "next";
import { BookingStatus } from "@prisma/client";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, IndianRupee, MapPin, Users } from "lucide-react";
import { getAdminBookings } from "@/lib/admin-bookings";
import { getAdminEvents } from "@/lib/admin-data";
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  dayKey,
  isCalendarFilter,
  isSameDay,
  isWeekend,
  istDayOfMonth,
  istParts,
  monthKey,
  parseDayKey,
  parseMonthKey,
  statusLabel,
  statusTone,
  type CalendarFilter,
} from "@/lib/calendar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatIstDateLong, formatIstDateWithWeekday, formatIstTime, IST_TIMEZONE } from "@/lib/ist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/forms/empty-state";
import { PendingLink } from "@/components/admin/pending-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar",
  description: "A month view of every scheduled event, its time, and its location.",
  robots: { index: false, follow: false, nocache: true },
};

function monthLabel(date: Date) {
  // IST, like every other date the business shows. See `lib/ist.ts`.
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: IST_TIMEZONE }).format(date);
}

type SearchParams = Promise<{ month?: string; status?: string; day?: string }>;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = new Date();
  const current = parseMonthKey(params.month, today);
  // The year and month are read in IST, so the grid is the one the business
  // would draw on a wall calendar. See `lib/ist.ts`.
  const { year, month } = istParts(current);
  const filter: CalendarFilter = isCalendarFilter(params.status) ? params.status : "ALL";
  const selectedDate = parseDayKey(params.day);

  const [events, bookingData] = await Promise.all([getAdminEvents(), getAdminBookings()]);
  const bookings = bookingData.bookings;
  const cells = buildMonthGrid(year, month);

  const monthBookings = bookings.filter((booking) => {
    const parts = istParts(new Date(booking.eventDate));
    return parts.year === year && parts.month === month;
  });

  const visibleBookings = filter === "ALL" ? monthBookings : monthBookings.filter((booking) => booking.status === filter);

  const bookingsByDay = new Map<string, typeof bookings>();
  for (const booking of visibleBookings) {
    const key = dayKey(new Date(booking.eventDate));
    const list = bookingsByDay.get(key) ?? [];
    list.push(booking);
    bookingsByDay.set(key, list);
  }

  const eventsByDay = new Map<string, typeof events>();
  for (const event of events) {
    const key = dayKey(new Date(event.startDate));
    const list = eventsByDay.get(key) ?? [];
    list.push(event);
    eventsByDay.set(key, list);
  }

  const previous = addMonths(current, -1);
  const next = addMonths(current, 1);
  const todayParts = istParts(today);
  const isCurrentMonth = year === todayParts.year && month === todayParts.month;

  function navHref(nextMonth: Date, nextFilter: CalendarFilter = filter, day?: string) {
    const query = new URLSearchParams({ month: monthKey(nextMonth), status: nextFilter });
    if (day) query.set("day", day);
    return `/admin/calendar?${query.toString()}`;
  }

  const statusCounts = Object.values(BookingStatus).map((status) => ({
    status,
    count: monthBookings.filter((booking) => booking.status === status).length,
  }));
  const monthRevenue = monthBookings
    .filter((booking) => !["PENDING", "CANCELLED", "REJECTED"].includes(booking.status))
    .reduce((sum, booking) => sum + Number(booking.totalAmount), 0);
  const monthEvents = events.filter((event) => {
    const parts = istParts(new Date(event.startDate));
    return parts.year === year && parts.month === month;
  });

  const selectedBookings = selectedDate ? (bookingsByDay.get(dayKey(selectedDate)) ?? []) : [];
  const selectedEvents = selectedDate ? (eventsByDay.get(dayKey(selectedDate)) ?? []) : [];

  // Days that have something scheduled drive the mobile agenda view.
  const agendaDays = cells
    .filter((cell) => cell.inMonth)
    .map((cell) => ({ ...cell, dayBookings: bookingsByDay.get(dayKey(cell.date)) ?? [], dayEvents: eventsByDay.get(dayKey(cell.date)) ?? [] }))
    .filter((entry) => entry.dayBookings.length > 0 || entry.dayEvents.length > 0);

  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Operations calendar</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">See the month at a glance.</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">Upcoming bookings and connected event records in one schedule.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PendingLink
            href={navHref(today, filter)}
            active={isCurrentMonth}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${isCurrentMonth ? "border-amber-400 bg-amber-50 text-amber-900" : "border-[var(--line)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]"}`}
          >
            Today
          </PendingLink>
          <PendingLink href={navHref(previous, filter)} label="Previous month" className="rounded-full border border-[var(--line)] p-2 text-[var(--foreground)] hover:bg-[var(--surface-muted)]">
            <ChevronLeft className="h-5 w-5" />
          </PendingLink>
          <p className="min-w-40 text-center text-lg font-semibold">{monthLabel(current)}</p>
          <PendingLink href={navHref(next, filter)} label="Next month" className="rounded-full border border-[var(--line)] p-2 text-[var(--foreground)] hover:bg-[var(--surface-muted)]">
            <ChevronRight className="h-5 w-5" />
          </PendingLink>
        </div>
      </section>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-amber-700" />{monthLabel(current)}</CardTitle>
              <CardDescription>Bookings appear on their event date. Select a day for full details.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["ALL", ...Object.values(BookingStatus)] as CalendarFilter[]).map((status) => {
                const active = filter === status;
                return (
                  <PendingLink
                    key={status}
                    href={navHref(current, status)}
                    active={active}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${active ? "border-amber-500 bg-amber-500 text-stone-950" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-muted)]"}`}
                  >
                    {status === "ALL" ? "All" : statusLabel(status)}
                  </PendingLink>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop / tablet month grid */}
          <div className="hidden sm:block">
            <div className="grid grid-cols-7 gap-2 border-b border-[var(--line)] pb-3 text-center text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2">
              {cells.map(({ date, inMonth }) => {
                const key = dayKey(date);
                // The in/out-of-month prefix guarantees a unique key even if a
                // leading/trailing cell ever resolved to an in-month date.
                const cellKey = `${inMonth ? "m" : "a"}-${key}`;
                const dayBookings = bookingsByDay.get(key) ?? [];
                const dayEvents = eventsByDay.get(key) ?? [];
                const isToday = isSameDay(date, today);
                const isSelected = isSameDay(date, selectedDate);
                const weekend = isWeekend(date);
                return (
                  <div
                    key={cellKey}
                    className={`flex min-h-32 flex-col rounded-2xl border p-2 transition-colors ${inMonth ? "border-[var(--line)] bg-[var(--card)]" : "border-transparent bg-[var(--surface-muted)]/40"} ${weekend && inMonth ? "bg-[var(--surface-muted)]/60" : ""} ${isSelected ? "border-amber-500 ring-2 ring-amber-500/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <Link
                        href={navHref(current, filter, key)}
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-semibold transition hover:bg-[var(--surface)] ${isToday ? "bg-amber-500 text-stone-950" : inMonth ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}
                        aria-label={`View ${date.toDateString()}`}
                      >
                        {istDayOfMonth(date)}
                      </Link>
                      {isToday ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500 sm:hidden" aria-hidden="true" /> : null}
                    </div>
                    <div className="mt-1.5 grid gap-1">
                      {dayBookings.slice(0, 3).map((booking) => (
                        <Link
                          key={booking.id}
                          href={`/admin/bookings/${booking.id}`}
                          className={`truncate rounded-lg px-1.5 py-1 text-[11px] font-medium transition ${statusTone(booking.status).chip}`}
                          title={`${booking.customer.user.firstName} - ${statusLabel(booking.status)}`}
                        >
                          {booking.customer.user.firstName} · {booking.eventType.toLowerCase()}
                        </Link>
                      ))}
                      {dayBookings.length > 3 ? (
                        <Link href={navHref(current, filter, key)} className="px-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
                          +{dayBookings.length - 3} more
                        </Link>
                      ) : null}
                      {dayEvents.length > 0 ? (
                        <p className="px-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">{dayEvents.length} event record{dayEvents.length > 1 ? "s" : ""}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile agenda view - no horizontal scrolling */}
          <div className="space-y-3 sm:hidden">
            {agendaDays.length === 0 ? (
              <p className="rounded-2xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">Nothing scheduled this month.</p>
            ) : (
              agendaDays.map(({ date, dayBookings, dayEvents }) => (
                <div key={`agenda-${dayKey(date)}`} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${isSameDay(date, today) ? "bg-amber-500 text-stone-950" : "bg-[var(--surface-muted)] text-[var(--foreground)]"}`}>
                      {istDayOfMonth(date)}
                    </span>
                    <p className="text-sm font-semibold">{formatIstDateWithWeekday(date)}</p>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {dayBookings.map((booking) => (
                      <Link key={booking.id} href={`/admin/bookings/${booking.id}`} className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs font-medium ${statusTone(booking.status).chip}`}>
                        <span className="truncate">{booking.customer.user.firstName} · {booking.eventType.toLowerCase()}</span>
                        <span className="shrink-0 opacity-70">{statusLabel(booking.status)}</span>
                      </Link>
                    ))}
                    {dayEvents.map((event) => (
                      <Link key={event.id} href={`/admin/bookings/${event.bookingId}`} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)]">
                        <span className="truncate">{event.title}</span>
                        <span className="shrink-0 opacity-70">{formatIstTime(event.startDate)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {selectedDate ? (
        <Card className="border-amber-300">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-xl">{formatIstDateLong(selectedDate)}</CardTitle>
              <CardDescription>{selectedBookings.length} booking{selectedBookings.length === 1 ? "" : "s"} · {selectedEvents.length} event record{selectedEvents.length === 1 ? "" : "s"}</CardDescription>
            </div>
            <Link href={navHref(current, filter)}><Button variant="outline" size="sm">Clear selection</Button></Link>
          </CardHeader>
          <CardContent>
            {selectedBookings.length === 0 && selectedEvents.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Nothing scheduled on this day.</p>
            ) : (
              <div className="grid gap-3">
                {selectedBookings.map((booking) => (
                  <Link key={booking.id} href={`/admin/bookings/${booking.id}`} className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] p-4 transition hover:border-amber-300 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{booking.customer.user.firstName} {booking.customer.user.lastName ?? ""}</p>
                        <Badge className={statusTone(booking.status).chip}>{statusLabel(booking.status)}</Badge>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{booking.location}</span>
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{booking.guestCount} guests</span>
                        <span className="inline-flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" />{formatCurrency(booking.totalAmount)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-sm text-[var(--muted)]">{booking.eventType.toLowerCase()}</span>
                  </Link>
                ))}
                {selectedEvents.map((event) => (
                  <Link key={event.id} href={`/admin/bookings/${event.bookingId}`} className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">{event.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                        <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatIstTime(event.startDate)} – {formatIstTime(event.endDate)}</span>
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.location}</span>
                      </p>
                    </div>
                    <Badge className="w-fit shrink-0">Event record</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Month summary</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Bookings</span><span className="font-semibold">{monthBookings.length}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Connected events</span><span className="font-semibold">{monthEvents.length}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Booked value</span><span className="font-semibold">{formatCurrency(monthRevenue)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Guests expected</span><span className="font-semibold">{monthBookings.reduce((sum, booking) => sum + booking.guestCount, 0).toLocaleString("en-IN")}</span></div>
            <p className="mt-2 text-xs text-[var(--muted)]">Last refreshed {formatDate(new Date())}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Status breakdown</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {statusCounts.every((entry) => entry.count === 0) ? (
              <p className="text-sm text-[var(--muted)]">No bookings this month.</p>
            ) : (
              statusCounts.map(({ status, count }) => (
                <Link key={status} href={navHref(current, status)} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm transition hover:bg-[var(--surface-muted)]">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusTone(status).dot}`} aria-hidden="true" />
                    {statusLabel(status)}
                  </span>
                  <span className="font-semibold">{count}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Connected event records</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {monthEvents.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No event records this month.</p>
            ) : (
              monthEvents.slice(0, 8).map((event) => (
                <Link key={event.id} href={`/admin/bookings/${event.bookingId}`} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] p-3 text-sm transition hover:bg-[var(--surface-strong)]">
                  <span className="truncate font-medium">{event.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]"><MapPin className="h-3.5 w-3.5" />{event.location}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {visibleBookings.length === 0 && filter !== "ALL" ? (
        <EmptyState title={`No ${statusLabel(filter).toLowerCase()} bookings`} description="Try a different status filter or month." />
      ) : null}
    </main>
  );
}
