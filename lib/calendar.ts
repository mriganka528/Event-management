import { BookingStatus } from "@prisma/client";

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

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthKey(value: string | undefined, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  const [year, month] = value.split("-").map(Number);
  if (year < 1970 || year > 9999 || month < 1 || month > 12) return fallback;
  return new Date(year, month - 1, 1);
}

export function parseDayKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  // Reject values like 2026-02-31 that roll over into another month.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function isSameDay(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return false;
  return dayKey(a) === dayKey(b);
}

export function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export type MonthCell = { date: Date; inMonth: boolean };

/**
 * Builds a full-week grid (minimum rows needed) covering the given month.
 * Leading/trailing cells come from the adjacent months, so their day counts
 * must come from those months - using the current month's length overflows
 * `new Date(...)` into the current month and produces duplicate dates.
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const leading = firstDay.getDay();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: total }, (_, index) => {
    const dayNumber = index - leading + 1;
    // dayNumber 0 is the last day of the previous month, -1 the day before that, ...
    if (dayNumber < 1) return { date: new Date(year, month - 1, daysInPrevMonth + dayNumber), inMonth: false };
    // dayNumber daysInMonth+1 is the 1st of the next month, and so on.
    if (dayNumber > daysInMonth) return { date: new Date(year, month + 1, dayNumber - daysInMonth), inMonth: false };
    return { date: new Date(year, month, dayNumber), inMonth: true };
  });
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
