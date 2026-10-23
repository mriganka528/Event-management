import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, CheckCircle2, ChevronDown, Clock3, Mail, MapPin, Phone, Users } from "lucide-react";
import { StaffStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_USER_FIELDS } from "@/lib/user-fields";
import { requireStaffPage } from "@/lib/route-guards";
import { updateOwnAvailabilityFormAction } from "@/lib/form-actions";
import { formatEventRange } from "@/lib/utils";
import { isAssignmentLive } from "@/lib/staff-assignment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoShiftsState } from "@/components/staff/no-shifts-state";
import { ActionForm } from "@/components/forms/action-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My shifts",
  description: "Your event-day assignments and whether you are marked available.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The assignments for one staff member.
 *
 * The services are what the shift is actually about: a driver needs to know
 * whether they are collecting crockery or dropping it off, and neither the
 * event type nor the venue says so.
 */
async function loadAssignments(staffId: string) {
  return prisma.bookingStaff.findMany({
    where: { staffId },
    include: {
      booking: {
        include: {
          customer: { include: { user: { select: CUSTOMER_USER_FIELDS } } },
          package: true,
          event: true,
          bookingServices: { include: { service: true } },
        },
      },
    },
    orderBy: { booking: { eventDate: "asc" } },
  });
}

/** One assignment, as the shift list needs it. */
type StaffAssignment = Awaited<ReturnType<typeof loadAssignments>>[number];

/**
 * One shift on the staff member's list.
 *
 * The whole card used to be a `mailto:` link, so tapping a shift opened the
 * visitor's email client and showed nothing at all. A staff member tapping
 * their shift wants the shift: who it is for, where it is, and what they are
 * setting up. The customer's contact details are a button inside, where
 * pressing them is clearly deliberate.
 */
function ShiftCard({ assignment, finished }: { assignment: StaffAssignment; finished: boolean }) {
  const booking = assignment.booking;
  return (
    <details className="group rounded-2xl border border-stone-200 transition open:border-amber-300">
      <summary className="flex cursor-pointer list-none flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="shrink-0 rounded-2xl bg-amber-100 p-3 text-amber-800">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="break-words font-semibold">
              {booking.customer.user.firstName} {booking.customer.user.lastName ?? ""} · {booking.eventType.toLowerCase()}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5 shrink-0" />
                {formatEventRange(booking.eventDate, booking.durationDays)}
              </span>
              {/*
                A venue address is a free-text field, so it is the one value
                here that can be long. It breaks rather than pushing the row
                wider than the card.
              */}
              <span className="inline-flex min-w-0 items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{booking.location}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 shrink-0" />
                {booking.guestCount} guests
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:shrink-0">
          {finished ? (
            <Badge className="bg-stone-100 text-stone-600">Finished</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-800">{booking.status.toLowerCase()}</Badge>
          )}
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted)] transition group-open:rotate-180" aria-hidden="true" />
        </div>
      </summary>

      <div className="border-t border-stone-200 px-4 pb-4 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">What you are setting up</p>
            {booking.bookingServices.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-[var(--foreground)]">
                {booking.bookingServices.map((item) => (
                  <li key={item.id} className="break-words">
                    {item.quantity} × {item.service.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                {booking.package?.name ?? "Custom services"}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Customer contact</p>
            <p className="mt-2 break-words text-sm text-[var(--foreground)]">
              {booking.customer.user.firstName} {booking.customer.user.lastName ?? ""}
            </p>
            {/*
              Contact is a button, not the card. It used to be the card, which
              meant every tap on a shift tried to open an email client.
            */}
            <div className="mt-2 flex flex-wrap gap-2">
              {booking.customer.user.phone ? (
                <a href={`tel:${booking.customer.user.phone}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--surface-muted)]">
                  <Phone className="h-3.5 w-3.5" />{booking.customer.user.phone}
                </a>
              ) : null}
              <a href={`mailto:${booking.customer.user.email}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--surface-muted)]">
                <Mail className="h-3.5 w-3.5" />Email customer
              </a>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

export default async function StaffDashboardPage() {
  const user = await requireStaffPage();
  const staff = user.staffProfile;
  // Invited staff must activate their account before they can see assignments.
  if (staff && staff.status !== StaffStatus.ACTIVE) redirect("/staff/pending");
  const assignments = staff ? await loadAssignments(staff.id).catch(() => []) : [];
  /*
   * A shift is live while its event still has work ahead of it.
   *
   * The moment an event ends — the dates pass, or the booking is completed —
   * the staff member is released from it and free for the next one. The shift
   * stays on their list as history, because it is a record of the work they
   * did, but it is no longer counted as something to attend.
   */
  const live = assignments.filter((assignment) => isAssignmentLive(assignment.booking));
  const finished = assignments.filter((assignment) => !isAssignmentLive(assignment.booking));
  const upcoming = live;
  const completed = finished;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Field operations</p>
          {/*
            The scale steps down on a phone. "Your event day, simplified." is a
            long heading, and at 4xl it ran past the edge of a narrow screen.
          */}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Your event day, simplified.</h1>
          <p className="mt-3 text-[var(--muted)]">See assigned events, locations, timings, and your current availability.</p>
        </div>
        {staff ? (
          <ActionForm action={updateOwnAvailabilityFormAction} className="w-full shrink-0 sm:w-auto">
            <input type="hidden" name="isAvailable" value={staff.isAvailable ? "false" : "true"} />
            <Button variant={staff.isAvailable ? "outline" : "default"} className="w-full sm:w-auto">
              <span className={`mr-2 h-2 w-2 shrink-0 rounded-full ${staff.isAvailable ? "bg-emerald-500" : "bg-stone-400"}`} />
              {staff.isAvailable ? "Set unavailable" : "Set available"}
            </Button>
          </ActionForm>
        ) : (
          <p className="text-sm text-[var(--muted)]">You are viewing the staff workspace as an administrator.</p>
        )}
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-[var(--muted)]">Upcoming assignments</p>
            <p className="mt-2 text-3xl font-semibold">{upcoming.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-[var(--muted)]">Completed events</p>
            <p className="mt-2 text-3xl font-semibold">{completed.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-[var(--muted)]">Current status</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${staff?.isAvailable ? "bg-emerald-500" : "bg-stone-400"}`} />
              {staff?.isAvailable ? "Available" : "Unavailable"}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card id="my-shifts" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 shrink-0 text-amber-700" />
            My shifts
          </CardTitle>
          <CardDescription>Your current and upcoming work orders.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <NoShiftsState isAvailable={staff ? staff.isAvailable : undefined} role={staff?.staffType ?? null} />
          ) : (
            <div className="grid gap-6">
              {live.length > 0 ? (
                <div className="grid gap-3">
                  {live.map((assignment) => (
                    <ShiftCard key={assignment.id} assignment={assignment} finished={false} />
                  ))}
                </div>
              ) : null}
              {finished.length > 0 ? (
                <div className="grid gap-3">
                  {/*
                    The shifts that are over. They stay on the list because
                    they are a record of the work done, but they are moved out
                    of the way — a released shift is not something to attend,
                    and a staff member should not have to read past them to
                    find the one they are working.
                  */}
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Finished ({finished.length})
                  </p>
                  {finished.map((assignment) => (
                    <ShiftCard key={assignment.id} assignment={assignment} finished />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
