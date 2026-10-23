import { BookingStatus } from "@prisma/client";
import { istDayKey, IST_OFFSET_MINUTES, utcFromIstDayKey } from "@/lib/ist";

export const CALENDAR_STATUSES = [
  "ALL",
  BookingStatus.PENDING,
  BookingStatus.APPROVED,
  BookingStatus.PREPARING,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.REJECTED,
] as const;

export type CalendarFilter = (typeof CALENDAR_STATUSES)[number];

export function isCalendarFilter(value: string | undefined): value is CalendarFilter {
  return typeof value === "string" && (CALENDAR_STATUSES as readonly string[]).includes(value);
}

/**
 * The calendar day a moment falls on, in IST.
 *
 * The timezone is explicit because the alternative is the host's: an event at
 * 2am IST is on the previous UTC day, so a UTC-based key put an early
 * morning shift on yesterday's date in the operations calendar.
 */
export function dayKey(date: Date) {
  return istDayKey(date);
}

/**
 * The month a moment falls on, in IST.
 *
 * The key is the same shape the day key uses, so the two agree about which
 * month a day belongs to.
 */
export function monthKey(date: Date) {
  const key = istDayKey(date);
  return key ? key.slice(0, 7) : "";
}

/**
 * The year, month, and day of a moment, in IST.
 *
 * The `getFullYear`/`getMonth`/`getDate` trio reads the *host's* timezone, so
 * on a UTC server a moment at 2am IST reported yesterday's month. These read
 * the IST calendar instead.
 */
export function istParts(date: Date) {
  const key = istDayKey(date);
  if (!key) return { year: 0, month: 0, day: 0 };
  const [year, month, day] = key.split("-").map(Number);
  // The month is zero-based everywhere else in the application.
  return { year, month: month - 1, day };
}

/** The day of the month a moment falls on, in IST. */
export function istDayOfMonth(date: Date) {
  return istParts(date).day;
}

/** The day of the week a moment falls on, in IST. `0` is Sunday. */
export function istDayOfWeek(date: Date) {
  const { year, month, day } = istParts(date);
  // The weekday of a day is the weekday of its IST midnight, which is what
  // `new Date` computes for any instant at or after that midnight.
  const midnight = utcFromIstDayKey(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  if (!midnight) return 0;
  // The instant is in UTC, so the weekday has to be read in IST — which is
  // `day + 1` shifted by the offset, taken from the UTC instant itself.
  const shifted = new Date(midnight.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCDay();
}

export function parseMonthKey(value: string | undefined, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  const [year, month] = value.split("-").map(Number);
  if (year < 1970 || year > 9999 || month < 1 || month > 12) return fallback;
  return istDate(year, month - 1, 1);
}

export function parseDayKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = istDate(year, month - 1, day);
  // Reject values like 2026-02-31 that roll over into another month.
  const parts = istParts(date);
  if (parts.year !== year || parts.month !== month - 1 || parts.day !== day) return null;
  return date;
}

export function addMonths(date: Date, delta: number) {
  const { year, month } = istParts(date);
  const total = year * 12 + month + delta;
  return istDate(Math.floor(total / 12), ((total % 12) + 12) % 12, 1);
}

export function isSameDay(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return false;
  return dayKey(a) === dayKey(b);
}

export function isWeekend(date: Date) {
  const day = istDayOfWeek(date);
  return day === 0 || day === 6;
}

/**
 * A date at IST midnight.
 *
 * The calendar's day numbers, weekdays, and month grid are all read from these
 * dates, so they have to be anchored to the timezone the business is in.
 * Building them with `new Date(year, month, day)` would anchor them to the
 * server's timezone instead, and the grid would shift by a day on a UTC host.
 *
 * Always succeeds for a real year, month, and day: a day zero or a day past
 * the end of a month rolls over, which is what the callers rely on when they
 * ask for the last day of a month.
 */
function istDate(year: number, month: number, day: number): Date {
  const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return utcFromIstDayKey(key) ?? new Date(0);
}

export type MonthCell = { date: Date; inMonth: boolean };

/**
 * Builds a full-week grid (minimum rows needed) covering the given month.
 * Leading/trailing cells come from the adjacent months, so their day counts
 * must come from those months - using the current month's length overflows
 * `new Date(...)` into the current month and produces duplicate dates.
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstDay = istDate(year, month, 1);
  const daysInMonth = daysInMonthOf(year, month);
  const daysInPrevMonth = daysInMonthOf(year, month - 1);
  const leading = istDayOfWeek(firstDay);
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: total }, (_, index) => {
    const dayNumber = index - leading + 1;
    // dayNumber 0 is the last day of the previous month, -1 the day before that, ...
    if (dayNumber < 1) return { date: istDate(year, month - 1, daysInPrevMonth + dayNumber), inMonth: false };
    // dayNumber daysInMonth+1 is the 1st of the next month, and so on.
    if (dayNumber > daysInMonth) return { date: istDate(year, month + 1, dayNumber - daysInMonth), inMonth: false };
    return { date: istDate(year, month, dayNumber), inMonth: true };
  });
}

/** How many days a month has, in the Gregorian calendar. */
function daysInMonthOf(year: number, month: number): number {
  // Day zero of the following month is the last day of this one.
  const firstOfNext = istDate(year, month + 1, 0);
  if (!firstOfNext) return 30;
  return istParts(firstOfNext).day;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type StatusTone = { chip: string; dot: string; label: string };

const STATUS_TONES: Record<string, StatusTone> = {
  [BookingStatus.PENDING]: { chip: "bg-amber-100 text-amber-900 hover:bg-amber-200", dot: "bg-amber-500", label: "Pending" },
  [BookingStatus.APPROVED]: { chip: "bg-emerald-100 text-emerald-900 hover:bg-emerald-200", dot: "bg-emerald-500", label: "Approved" },
  [BookingStatus.PREPARING]: { chip: "bg-sky-100 text-sky-900 hover:bg-sky-200", dot: "bg-sky-500", label: "Preparing" },
  [BookingStatus.COMPLETED]: { chip: "bg-stone-200 text-stone-800 hover:bg-stone-300", dot: "bg-stone-500", label: "Completed" },
  [BookingStatus.CANCELLED]: { chip: "bg-stone-100 text-stone-500 line-through hover:bg-stone-200", dot: "bg-stone-400", label: "Cancelled" },
  [BookingStatus.REJECTED]: { chip: "bg-red-100 text-red-800 hover:bg-red-200", dot: "bg-red-500", label: "Rejected" },
};

const FALLBACK_TONE: StatusTone = { chip: "bg-stone-100 text-stone-700", dot: "bg-stone-400", label: "Unknown" };

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? FALLBACK_TONE;
}

export function statusLabel(status: string) {
  return statusTone(status).label;
}
