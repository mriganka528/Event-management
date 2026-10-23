import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatIstDate, formatIstDateShort, formatIstDateTime } from "@/lib/ist";
import { eventEndDate } from "@/lib/event-dates";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A date and time, in IST.
 *
 * The timezone is stated rather than inherited: `Intl.DateTimeFormat` without
 * one uses the *host's* timezone, so a deployment on Vercel (UTC) rendered
 * every time five and a half hours behind the business, and the same booking
 * read differently in production than on a laptop in IST. See `lib/ist.ts`.
 */
export function formatCurrency(value: number | string | { toString(): string }, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value.toString()));
  } catch {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value.toString()));
  }
}

export function formatDate(value: Date | string) {
  return formatIstDateTime(value);
}

/**
 * A calendar date, in IST, with no time.
 *
 * The event date is a day, not an instant — "the 2nd" — so the time on it is
 * an artifact of how the value happens to be stored, and printing it told the
 * reader a false half-hour. Every screen that shows the day an event falls on
 * uses this.
 */
export function formatEventDate(value: Date | string) {
  return formatIstDate(value);
}

/**
 * The span of an event, in IST.
 *
 * A one-day event is a single date. A longer one shows both ends, because a
 * customer who booked three days needs to see the three days rather than a
 * start date and a number they have to do the arithmetic on.
 *
 * The end is worked out from the calendar day rather than by adding hours to
 * the stored value, so a booking written before the timezone was stated and one
 * written after it give the same answer.
 */
export function formatEventRange(start: Date | string, days: number) {
  const count = Math.max(1, Math.round(Number.isFinite(days) ? days : 1));
  if (count === 1) return formatIstDate(start);
  const end = eventEndDate(start, count);
  return `${formatIstDate(start)} – ${formatIstDate(end ?? start)}`;
}

/** Short date without the time, for tight mobile layouts. */
export function formatDateShort(value: Date | string) {
  return formatIstDateShort(value);
}

/** Compact money label (Rs 1.2L / Rs 45K) for chart axes and small cards. */
export function formatCurrencyCompact(value: number | string, currency = "INR") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const symbol = currency === "INR" ? "₹" : "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}${symbol}${trimZero(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${trimZero(abs / 1_000)}K`;
  return `${sign}${symbol}${trimZero(abs)}`;
}

function trimZero(value: number) {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)+/g, "");
  return slug || "item";
}
