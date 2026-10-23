import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BookingStatus } from "@prisma/client";

import {
  ACTIVE_BOOKING_STATUSES,
  eventRangesOverlap,
  hasEventEnded,
  isAssignmentLive,
  isTerminalBookingStatus,
} from "@/lib/staff-assignment";

/**
 * Releasing a staff member when the event ends.
 *
 * The complaint was that a Remove button sat beside a staff member long after
 * their event was over, and that the person was still held by it. The
 * assignment outlived the event, so the team list was a list of work already
 * done and the person was unavailable for the next booking.
 *
 * The rule is derived from the booking and the calendar rather than stored,
 * so it is right for every assignment that already exists — there is nothing
 * to migrate and nothing that can drift out of step with the booking.
 */

const event = (over: Partial<{ status: BookingStatus; eventDate: string; durationDays: number }> = {}) => ({
  status: over.status ?? BookingStatus.APPROVED,
  eventDate: over.eventDate ?? "2026-11-20",
  durationDays: over.durationDays ?? 1,
});

test("a booking that is still to happen holds its staff member", () => {
  assert.equal(isAssignmentLive(event()), true);
  assert.equal(isAssignmentLive(event({ status: BookingStatus.PENDING })), true);
  assert.equal(isAssignmentLive(event({ status: BookingStatus.PREPARING })), true);
});

test("a finished event releases its staff member", () => {
  // The booking was completed, so the work is done and there is nothing left
  // to change.
  assert.equal(isAssignmentLive(event({ status: BookingStatus.COMPLETED })), false);
  assert.equal(isAssignmentLive(event({ status: BookingStatus.CANCELLED })), false);
  assert.equal(isAssignmentLive(event({ status: BookingStatus.REJECTED })), false);
});

test("an event whose dates have passed releases its staff member", () => {
  // Nobody remembered to mark the booking complete, and the event was three
  // weeks ago. The person is working somebody else's event this week, so they
  // must not still be held by this one.
  const later = new Date("2026-10-20T00:00:00.000Z");
  assert.equal(isAssignmentLive(event({ eventDate: "2026-10-01" }), later), false);
  assert.equal(hasEventEnded(event({ eventDate: "2026-10-01" }), later), true);
});

test("an event is released on the day after it ends, not on its last day", () => {
  // A crew is working the last day of a three-day function, so the event has
  // not ended yet.
  const during = new Date("2026-11-22T09:00:00.000Z");
  const threeDays = event({ eventDate: "2026-11-20", durationDays: 3 });
  assert.equal(isAssignmentLive(threeDays, during), true);
  // The day after the last day, it is over.
  const after = new Date("2026-11-24T09:00:00.000Z");
  assert.equal(isAssignmentLive(threeDays, after), false);
});

test("a multi-day event holds the person for every day it runs", () => {
  // The person is booked for the 20th to the 22nd, so the 21st is not free.
  const threeDays = event({ eventDate: "2026-11-20", durationDays: 3 });
  const middle = event({ eventDate: "2026-11-21" });
  assert.equal(eventRangesOverlap(threeDays, middle), true);
  // And the day after it is free.
  const after = event({ eventDate: "2026-11-23" });
  assert.equal(eventRangesOverlap(threeDays, after), false);
});

test("the booking states that hold work and the states that do not are explicit", () => {
  assert.deepEqual([...ACTIVE_BOOKING_STATUSES], [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.PREPARING]);
  assert.equal(isTerminalBookingStatus(BookingStatus.COMPLETED), true);
  assert.equal(isTerminalBookingStatus(BookingStatus.APPROVED), false);
});

test("a released assignment is not offered a Remove button", () => {
  // The button is the complaint. It must not be rendered for an event that
  // is over, in either place the roster appears.
  const operations = readFileSync("components/admin/booking-operations.tsx", "utf8");
  const detail = readFileSync("app/(admin)/admin/bookings/[id]/page.tsx", "utf8");

  assert.match(operations, /teamReleased \? \(/, "the roster must show a released state");
  assert.match(operations, /Released/, "and say so");
  assert.match(detail, /teamReleased \? <Badge className="bg-\[var\(--surface-strong\)\] text-\[var\(--muted\)\]">Released/, "the booking page must do the same");

  // The Remove button sits in the branch that only runs while the team is
  // still booked. The guard is the `teamReleased` check, and the form follows
  // it rather than preceding it.
  const releasedGuard = operations.indexOf("{teamReleased ? (");
  const removeForm = operations.indexOf("<form action={unassignAction}");
  assert.ok(releasedGuard > 0, "the roster must check whether the team was released");
  assert.ok(removeForm > releasedGuard, "the remove form must come after the released check");
});

test("the server refuses to change a released assignment", () => {
  // The button is hidden, but a stale form post could still try. The rule is
  // enforced on the server too.
  const actions = readFileSync("lib/actions.ts", "utf8");
  const unassign = actions.slice(actions.indexOf("export async function unassignStaffAction"), actions.indexOf("export async function cancelBookingAction"));
  assert.match(unassign, /isAssignmentLive\(assignment\.booking\)/, "the release rule must be enforced server-side");
  assert.match(unassign, /its team list is a record of who worked it/);
});

test("a released assignment does not block the person from another event", () => {
  // The point of releasing: the person is free for the next booking.
  const actions = readFileSync("lib/actions.ts", "utf8");
  const assign = actions.slice(actions.indexOf("export async function assignStaffAction"), actions.indexOf("export async function unassignStaffAction"));
  assert.match(assign, /if \(!isAssignmentLive\(other\)\) return false;/, "a finished assignment must not stand in the way");
  assert.match(assign, /eventRangesOverlap\(/, "and the whole range must be compared");
});

test("the staff screen counts only the assignments that still hold the person", () => {
  // The count was every assignment a member had ever had, so somebody who had
  // worked six events read as holding six.
  const page = readFileSync("app/(admin)/admin/staff/page.tsx", "utf8");
  assert.match(page, /member\.assignments\.filter\(\(assignment\) => isAssignmentLive\(assignment\.booking\)\)\.length/, "the count must be the live assignments");
  assert.match(page, /current assignment/, "and the card must say what it counts");
});

test("the staff member's own list separates the shifts they are working from the ones they have finished", () => {
  const page = readFileSync("app/(staff)/staff/page.tsx", "utf8");
  assert.match(page, /const live = assignments\.filter\(\(assignment\) => isAssignmentLive\(assignment\.booking\)\)/);
  assert.match(page, /Finished \(\{finished\.length\}\)/, "the finished shifts must be moved out of the way");
});
