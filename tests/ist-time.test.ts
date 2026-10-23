import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { eventDayCount, eventEndDate, MAX_EVENT_DAYS } from "@/lib/event-dates";
import {
  formatIstDate,
  formatIstDateLong,
  formatIstDateTime,
  formatIstTime,
  istDayKey,
  istStartOfDay,
  istTodayKey,
  parseIstLocalInput,
  toIstLocalInput,
} from "@/lib/ist";
import { bookingSchema } from "@/lib/validation";

/**
 * Indian Standard Time.
 *
 * The business runs in India, and the server does not. On Vercel the host is
 * UTC, so a formatter that leaves the timezone alone renders every time five
 * and a half hours behind what the business meant — a payment received at 3pm
 * IST shown as 9:30am, and an event on the 2nd shown on the 1st.
 *
 * These tests pin the rules that keep the two the same.
 */

test("a moment is placed on the IST calendar day it falls on", () => {
  // 2am IST on the 2nd is 8:30pm UTC on the 1st. The UTC day is the 1st; the
  // IST day is the 2nd, which is the day the business means.
  const twoAmIst = new Date("2026-11-01T18:30:00.000Z");
  assert.equal(istDayKey(twoAmIst), "2026-11-02");
  // And the other side of the boundary, for completeness.
  const elevenThirtyIst = new Date("2026-11-02T06:00:00.000Z");
  assert.equal(istDayKey(elevenThirtyIst), "2026-11-02");
});

test("a date and a time are shown in IST, whatever the host timezone is", () => {
  // 4:15pm IST. The odd minute matters: IST is half an hour ahead of UTC, and
  // a formatter that used the host's offset would land on 4:00 or 4:45
  // instead, which is the kind of error nobody notices until a crew arrives
  // an hour late.
  const value = new Date("2026-11-02T10:45:00.000Z");
  assert.match(formatIstTime(value), /4:15/);
  assert.match(formatIstDate(value), /2/);
  assert.match(formatIstDateTime(value), /2 Nov 2026/);
  assert.match(formatIstDateLong(value), /2 November 2026/);
});

test("today is today in India, not yesterday", () => {
  // 1am IST on the 2nd is still the 1st in UTC. The key has to be the 2nd, or
  // the booking form refuses a date that is already today for the customer.
  const justAfterMidnightIst = new Date("2026-11-01T18:30:00.000Z");
  assert.equal(istTodayKey(justAfterMidnightIst), "2026-11-02");
});

test("a date-only value is anchored to IST midnight", () => {
  // The customer typed "2026-11-02". That is the 2nd in India, and it has to
  // stay the 2nd in the database and on every screen.
  const stored = istStartOfDay("2026-11-02");
  assert.ok(stored);
  assert.equal(istDayKey(stored), "2026-11-02");
  // And it is the IST midnight instant, not the UTC one.
  assert.equal(stored.toISOString(), "2026-11-01T18:30:00.000Z");
});

test("a wall-clock time is read and written in IST", () => {
  // The admin's `datetime-local` field has no timezone. "2 November 2026,
  // 14:30" has to mean that time in India, and the field has to show it back
  // the same way.
  const parsed = parseIstLocalInput("2026-11-02T14:30");
  assert.ok(parsed);
  assert.equal(parsed.toISOString(), "2026-11-02T09:00:00.000Z");
  assert.equal(toIstLocalInput(parsed), "2026-11-02T14:30");
  // Midnight is the case that breaks: `en-CA` with a 24-hour clock renders it
  // as "24", which the input rejects.
  const midnight = parseIstLocalInput("2026-11-02T00:00");
  assert.ok(midnight);
  assert.equal(toIstLocalInput(midnight), "2026-11-02T00:00");
});

test("a date range counts the days it covers, in IST", () => {
  // The same day is one day.
  assert.equal(eventDayCount("2026-11-02", "2026-11-02"), 1);
  // Three days, both ends included.
  assert.equal(eventDayCount("2026-11-02", "2026-11-04"), 3);
  // A range across a month boundary.
  assert.equal(eventDayCount("2026-10-30", "2026-11-02"), 4);
  // And across a year boundary.
  assert.equal(eventDayCount("2025-12-31", "2026-01-02"), 3);
});

test("an end date before the start is not a range", () => {
  assert.equal(eventDayCount("2026-11-04", "2026-11-02"), null);
});

test("the range survives the timezone it is read in", () => {
  // The same range, read from a plain date and from the instant it is stored
  // as, must give the same answer — otherwise the estimate on screen and the
  // price charged would be computed from different lengths.
  const storedStart = istStartOfDay("2026-11-02");
  const storedEnd = istStartOfDay("2026-11-04");
  assert.ok(storedStart && storedEnd);
  assert.equal(eventDayCount("2026-11-02", "2026-11-04"), eventDayCount(storedStart, storedEnd));
});

test("the last day of a range is the day the customer named", () => {
  const end = eventEndDate("2026-11-02", 3);
  assert.ok(end);
  assert.equal(istDayKey(end), "2026-11-04");
});

test("the booking form and the server agree on the length of an event", () => {
  const base = {
    customerName: "Aarav Sharma",
    customerEmail: "aarav@example.com",
    customerPhone: "9876543210",
    eventType: "WEDDING",
    eventDate: "2026-11-02",
    eventEndDate: "2026-11-04",
    location: "Hotel ballroom",
    guestCount: 100,
    services: [{ serviceId: "service-1", quantity: 1 }],
  };
  // The end date decides the length.
  assert.equal(bookingSchema.parse(base).durationDays, 1, "the day count is derived by the server, not the form");
  // A range that ends before it starts is refused.
  assert.equal(bookingSchema.safeParse({ ...base, eventEndDate: "2026-11-01" }).success, false);
  // And one that runs longer than the business allows is refused.
  assert.equal(bookingSchema.safeParse({ ...base, eventEndDate: "2027-11-04" }).success, false);
  // A single-day event is still a valid request.
  assert.equal(bookingSchema.safeParse({ ...base, eventEndDate: "" }).success, true);
});

test("a range longer than the limit is refused by name", () => {
  const base = {
    customerName: "Aarav Sharma",
    customerEmail: "aarav@example.com",
    customerPhone: "9876543210",
    eventType: "WEDDING",
    eventDate: "2026-11-02",
    location: "Hotel ballroom",
    guestCount: 100,
    services: [{ serviceId: "service-1", quantity: 1 }],
  };
  const result = bookingSchema.safeParse({ ...base, eventEndDate: "2026-11-02" });
  assert.equal(result.success, true);
  // The limit itself.
  const long = bookingSchema.safeParse({ ...base, eventEndDate: "2028-01-01" });
  assert.equal(long.success, false);
  assert.equal(MAX_EVENT_DAYS, 60);
});

test("the event date is shown as a day, not as an instant", () => {
  /*
   * The event date is a calendar day. Printing the time on it told the reader
   * a false half-hour — the artifact of how the value happens to be stored.
   */
  const utils = readFileSync("lib/utils.ts", "utf8");
  assert.match(utils, /export function formatEventDate/, "there must be a date-only formatter");
  assert.match(utils, /formatIstDate\(value\)/, "and it must read the IST calendar day");

  // And every screen that shows the day an event falls on uses it.
  for (const file of [
    "app/(customer)/customer/dashboard/page.tsx",
    "app/(customer)/customer/bookings/[id]/page.tsx",
    "app/(customer)/customer/track/page.tsx",
    "app/(staff)/staff/page.tsx",
    "app/(admin)/admin/bookings/page.tsx",
    "app/(admin)/admin/bookings/[id]/page.tsx",
    "app/(admin)/admin/staff/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /formatDate\(booking\.eventDate\)/, `${file} must show the event date as a day`);
    assert.doesNotMatch(source, /formatDate\(assignment\.booking\.eventDate\)/, `${file} must show the event date as a day`);
  }
});
