import { istDayKey, istStartOfDay, utcFromIstDayKey } from "@/lib/ist";

/**
 * Event date arithmetic.
 *
 * The booking form and the server both have to turn a pair of dates into the
 * same number of days. When they disagree, the customer is quoted for one
 * length of event and the stock is reserved for another — which is exactly
 * what a per-day tent hire billed for three days but reserved for one looks
 * like on the operations screen.
 *
 * The arithmetic is done on IST calendar days, because a customer who picks
 * "the 2nd to the 4th" means those three days in their own timezone. See
 * `lib/ist.ts` for why the timezone has to be stated rather than inherited
 * from the server.
 *
 * So the arithmetic lives here, and both sides import it.
 */

/** How many days a booking may run for. Matches the field's own limit. */
export const MAX_EVENT_DAYS = 60;

/**
 * The number of days between two dates, counting both ends.
 *
 * A one-day event is a start and an end on the same day, so it counts as one
 * day rather than zero. Times of day are ignored: a booking runs for whole
 * days, and a start at 18:00 and an end at 09:00 the next morning is still
 * one night, not a day and a half.
 *
 * Returns `null` when the range cannot be read, or when the end is before the
 * start. `null` is deliberately distinct from `0`: zero days is not a booking,
 * and a caller that cannot tell the two apart would happily bill for nothing.
 */
export function eventDayCount(start: string | Date, end: string | Date): number | null {
  const startKey = dayKeyOf(start);
  const endKey = dayKeyOf(end);
  if (!startKey || !endKey) return null;
  const difference = Math.round((utcFromIstDayKey(endKey)!.getTime() - utcFromIstDayKey(startKey)!.getTime()) / 86_400_000);
  if (difference < 0) return null;
  return difference + 1;
}

/**
 * The last day of a range, as a `Date` at IST midnight.
 *
 * Anchored to IST midnight so the day is the one the customer named, whatever
 * timezone the server is in.
 */
export function eventEndDate(start: string | Date, days: number): Date | null {
  const startKey = dayKeyOf(start);
  if (!startKey) return null;
  const count = Math.max(1, Math.round(Number.isFinite(days) ? days : 1));
  const startDay = utcFromIstDayKey(startKey)!;
  return new Date(startDay.getTime() + (count - 1) * 86_400_000);
}

/**
 * The IST calendar day of a value, as `YYYY-MM-DD`.
 *
 * A date-only value — what a `date` input produces — is already a calendar
 * day and is taken at face value. A full timestamp is the day it falls on in
 * IST, which is not always the day it falls on in UTC.
 */
function dayKeyOf(value: string | Date): string | null {
  if (value instanceof Date) {
    return istDayKey(value);
  }
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    // A plain date is a calendar day, and the calendar day it names is the
    // one to use — not the day it happens to fall on in some other zone.
    return text;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return istDayKey(new Date(parsed));
}

export { istStartOfDay };
