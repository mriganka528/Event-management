import { BookingStatus } from "@prisma/client";
import { eventEndDate } from "@/lib/event-dates";
import { istDayKey, istStartOfDay } from "@/lib/ist";

/**
 * When a staff member is released from an event.
 *
 * An assignment used to sit on the booking forever. Once the event was over the
 * person was still listed against it, still counted in the team's "currently
 * assigned" total, and still had a Remove button beside their name — a button
 * for un-assigning somebody from work that had already happened.
 *
 * An assignment is *live* while the event still has work ahead of it. It ends
 * when either:
 *
 *  - the booking reaches a terminal state — completed, cancelled, or
 *    rejected — so the work is done and nothing is left to change; or
 *  - the event's own dates have passed, so the event is over whether or not
 *    anybody remembered to mark the booking complete.
 *
 * The second case is why this is derived rather than stored. A booking can
 * sit in APPROVED long after its date, and the person is working somebody
 * else's event that week. Deriving the state from the booking and the calendar
 * means it is right for every assignment that already exists, with nothing to
 * migrate and nothing to keep in step.
 *
 * The history is deliberately kept. The row says who worked which event, and
 * the staff screen shows a removed member's previous work from it — the same
 * reason the team is never deleted outright.
 */

/** The booking states in which an event can still have work done on it. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.APPROVED,
  BookingStatus.PREPARING,
];

/** The booking states in which an event is over and nothing can be changed. */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.REJECTED,
];

/** The part of a booking an assignment is judged on. */
export type AssignmentEvent = {
  status: BookingStatus;
  eventDate: Date | string;
  durationDays?: number | null;
};

/** Whether the booking is in a state where the event is over. */
export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

/**
 * Whether the event's own dates have passed.
 *
 * Read on the IST calendar, because a booking for the 2nd is the 2nd in
 * India whether the server is in India or not. The last day of the range
 * counts: an event that runs to the 4th has not ended on the 3rd.
 */
export function hasEventEnded(event: AssignmentEvent, now: Date = new Date()): boolean {
  const end = eventEndDate(event.eventDate, event.durationDays ?? 1);
  if (!end) return false;
  return istDayKey(now) > istDayKey(end);
}

/**
 * Whether the staff member is still working this event.
 *
 * The two rules together: the booking must still be workable, and the event's
 * dates must not have run out.
 */
export function isAssignmentLive(event: AssignmentEvent, now: Date = new Date()): boolean {
  if (isTerminalBookingStatus(event.status)) return false;
  if (!ACTIVE_BOOKING_STATUSES.includes(event.status)) return false;
  return !hasEventEnded(event, now);
}

/**
 * Whether two events run on the same day.
 *
 * A multi-day event occupies every day it runs, so it clashes with anything
 * on any of those days — not only with an event that starts on the same day.
 * That is what the range in the booking form is for, and a conflict check
 * that only looked at the first day would let the same person be booked for
 * the same event twice.
 */
export function eventRangesOverlap(a: AssignmentEvent, b: AssignmentEvent): boolean {
  const aStart = istStartOfDay(a.eventDate);
  const bStart = istStartOfDay(b.eventDate);
  if (!aStart || !bStart) return false;
  const aEnd = eventEndDate(a.eventDate, a.durationDays ?? 1) ?? aStart;
  const bEnd = eventEndDate(b.eventDate, b.durationDays ?? 1) ?? bStart;
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}
