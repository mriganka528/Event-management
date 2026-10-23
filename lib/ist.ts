/**
 * Indian Standard Time.
 *
 * The business runs in India, so every date and time a customer, a staff
 * member, or an administrator sees has to be in IST — regardless of where the
 * server happens to be running.
 *
 * This matters more than it looks. `Intl.DateTimeFormat` and `toLocaleString`
 * both default to the *host's* timezone, so a deployment on Vercel (which runs
 * in UTC) rendered every time five and a half hours behind what the business
 * meant, and rendered the same booking differently in production than on the
 * developer's laptop. A customer told their event starts at 8am and an
 * operations calendar that says 2:30pm are two different days of confusion.
 *
 * So the timezone is stated once, here, and every date the application formats
 * or compares goes through this module.
 */

/** The one timezone this business operates in. */
export const IST_TIMEZONE = "Asia/Kolkata";

/** IST is a fixed offset from UTC — India has no daylight saving. */
export const IST_OFFSET_MINUTES = 330;

/** A full date and time in IST, the way a person would say it aloud. */
export function formatIstDateTime(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** The date alone, in IST. */
export function formatIstDate(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** The date alone, in IST, without the time. */
export function formatIstDateShort(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** The time alone, in IST. */
export function formatIstTime(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** A date with its weekday, in IST. "Sat, 2 Nov" */
export function formatIstDateWithWeekday(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** A date with its weekday, in IST. "Saturday, 2 November 2026" */
export function formatIstDateLong(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/**
 * The calendar day a moment falls on, in IST, as `YYYY-MM-DD`.
 *
 * This is the key to every "is it the same day" comparison in the
 * application. A moment at 6pm IST is 12:30 UTC the same day, but a moment at
 * 2am IST is 8:30pm UTC the *previous* day — so comparing UTC calendar days
 * puts an early-morning shift on the wrong date.
 */
export function istDayKey(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "";
  // The `en-CA` locale formats as YYYY-MM-DD, which is exactly the shape the
  // application's day keys already use.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST_TIMEZONE,
  }).format(date);
}

/** Today's calendar day in IST, as `YYYY-MM-DD`. */
export function istTodayKey(now: Date = new Date()): string {
  return istDayKey(now);
}

/**
 * The IST midnight that starts the given calendar day.
 *
 * A date-only field — the day a customer picks for their event — has to be
 * anchored to a timezone, or the same booking lands on two different days
 * depending on who looks at it. IST midnight is the anchor, because the day
 * the customer typed is the day they meant in their own timezone.
 */
export function istStartOfDay(value: Date | string): Date | null {
  const date = toDate(value);
  if (!date) return null;
  // The UTC instant of IST midnight on that IST calendar day.
  const key = istDayKey(date);
  return utcFromIstDayKey(key);
}

/** The UTC instant of IST midnight for a `YYYY-MM-DD` key. */
export function utcFromIstDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const utcMidnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(utcMidnight)) return null;
  return new Date(utcMidnight - IST_OFFSET_MINUTES * 60_000);
}

/**
 * The IST day a moment falls on, as a `Date` at IST midnight.
 *
 * Used to compare two moments by the day the customer would name.
 */
export function istDayDate(value: Date | string): Date | null {
  const key = istDayKey(value);
  return key ? utcFromIstDayKey(key) : null;
}

/**
 * Parses a value the browser produced from a `datetime-local` input.
 *
 * `datetime-local` has no timezone: the browser writes "2026-11-02T14:30" and
 * means "2 November 2026, half past two, in my timezone". The server has to
 * read it in the same timezone the person typed it in, or the saved time
 * shifts by the difference between their offset and the server's.
 */
export function parseIstLocalInput(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0));
  if (!Number.isFinite(utc)) return null;
  return new Date(utc - IST_OFFSET_MINUTES * 60_000);
}

/**
 * Renders a moment as the value a `datetime-local` input expects.
 *
 * The inverse of {@link parseIstLocalInput}: the saved instant becomes the
 * wall-clock time in IST, so the field shows what it will actually mean.
 */
export function toIstLocalInput(value: Date | string): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST_TIMEZONE,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  // `en-CA` with `hour12: false` can render midnight as "24"; the input
  // rejects that, so it is pulled back to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Parses a value into a `Date`, or `null` when it cannot be read. */
function toDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const text = value.trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}
