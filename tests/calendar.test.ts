import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths,
  buildMonthGrid,
  dayKey,
  isCalendarFilter,
  isSameDay,
  isWeekend,
  monthKey,
  parseDayKey,
  parseMonthKey,
  statusLabel,
  statusTone,
} from "@/lib/calendar";

test("month and day keys are zero padded", () => {
  assert.equal(dayKey(new Date(2026, 8, 26)), "2026-09-26");
  assert.equal(monthKey(new Date(2026, 0, 5)), "2026-01");
  assert.equal(monthKey(new Date(2026, 11, 31)), "2026-12");
});

test("month key parsing rejects malformed or out-of-range input", () => {
  const fallback = new Date(2026, 8, 26);
  assert.equal(monthKey(parseMonthKey("2026-09", fallback)), "2026-09");
  assert.equal(monthKey(parseMonthKey("2026-13", fallback)), monthKey(fallback));
  assert.equal(monthKey(parseMonthKey("2026-00", fallback)), monthKey(fallback));
  assert.equal(monthKey(parseMonthKey("nonsense", fallback)), monthKey(fallback));
  assert.equal(monthKey(parseMonthKey(undefined, fallback)), monthKey(fallback));
  assert.equal(monthKey(parseMonthKey("../../etc/passwd", fallback)), monthKey(fallback));
});

test("day key parsing rejects rollover dates", () => {
  assert.equal(parseDayKey("2026-02-30"), null);
  assert.equal(parseDayKey("2026-13-01"), null);
  const parsed = parseDayKey("2026-09-26");
  assert.ok(parsed);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 26);
});

test("addMonths crosses year boundaries and always lands on the 1st", () => {
  assert.equal(monthKey(addMonths(new Date(2026, 0, 15), -1)), "2025-12");
  assert.equal(monthKey(addMonths(new Date(2026, 11, 15), 1)), "2027-01");
  assert.equal(addMonths(new Date(2026, 5, 20), 1).getDate(), 1);
});

test("month grid always has unique, consecutive day keys", () => {
  // Regression: leading cells were built with the *current* month's length, so a
  // shorter previous month overflowed into the current month and duplicated the
  // 1st/2nd (e.g. Aug 2026 produced "2026-08-01" twice and React threw a
  // duplicate-key error).
  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const grid = buildMonthGrid(year, month);
      const keys = grid.map((cell) => dayKey(cell.date));
      const unique = new Set(keys);
      assert.equal(unique.size, keys.length, `duplicate keys in ${year}-${month + 1}`);

      // The grid must be a run of consecutive days.
      const sorted = [...keys].sort();
      for (let i = 1; i < sorted.length; i++) {
        const previous = parseDayKey(sorted[i - 1])!;
        const current = parseDayKey(sorted[i])!;
        const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
        assert.equal(diffDays, 1, `gap in ${year}-${month + 1} between ${sorted[i - 1]} and ${sorted[i]}`);
      }
    }
  }
});

test("august 2026 grid does not duplicate the first of the month", () => {
  const grid = buildMonthGrid(2026, 7); // August 2026
  const keys = grid.map((cell) => dayKey(cell.date));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.filter((key) => key === "2026-08-01").length, 1);
  // Aug 1 2026 is a Saturday, so the week starts on July 26.
  assert.equal(keys[0], "2026-07-26");
  assert.equal(grid[0].inMonth, false);
});

test("leading and trailing cells belong to the adjacent months", () => {
  const grid = buildMonthGrid(2026, 7);
  const leading = grid.filter((cell) => !cell.inMonth && cell.date.getMonth() === 6);
  const trailing = grid.filter((cell) => !cell.inMonth && cell.date.getMonth() === 8);
  assert.ok(leading.length > 0);
  assert.ok(trailing.length > 0);
  assert.equal(leading.at(-1)!.date.getDate(), 31); // Jul 31
  assert.equal(trailing[0].date.getDate(), 1); // Sep 1
});

test("month grid always covers whole weeks and marks leading/trailing days", () => {
  // September 2026 starts on a Tuesday (index 2) and has 30 days.
  const grid = buildMonthGrid(2026, 8);
  assert.equal(grid.length % 7, 0);
  const inMonth = grid.filter((cell) => cell.inMonth);
  assert.equal(inMonth.length, 30);
  assert.equal(dayKey(inMonth[0].date), "2026-09-01");
  assert.equal(dayKey(inMonth.at(-1)!.date), "2026-09-30");
  assert.equal(grid[0].inMonth, false);
  assert.equal(dayKey(grid[0].date), "2026-08-30");
  // September 2026 starts on a Tuesday and has 30 days -> 5 rows (35 cells).
  assert.equal(grid.length, 35);
});

test("month grid handles a month that needs only 5 rows", () => {
  // February 2026 starts on a Sunday -> 28 days -> exactly 4 weeks.
  assert.equal(buildMonthGrid(2026, 1).length, 28);
});

test("every cell key is unique across four decades (duplicate-key regression)", () => {
  // A leading/trailing cell that resolves onto an in-month date produces
  // "Encountered two children with the same key" in the rendered grid.
  for (let year = 2000; year <= 2040; year++) {
    for (let month = 0; month < 12; month++) {
      const grid = buildMonthGrid(year, month);
      const keys = grid.map((cell) => dayKey(cell.date));
      const unique = new Set(keys);
      assert.equal(unique.size, keys.length, `duplicate key in ${year}-${month + 1}`);

      // The grid must also be strictly consecutive day-by-day.
      for (let index = 1; index < grid.length; index++) {
        const previous = grid[index - 1].date.getTime();
        const current = grid[index].date.getTime();
        const dayMs = 24 * 60 * 60 * 1000;
        assert.ok(
          Math.abs(current - previous - dayMs) < 60 * 1000,
          `non-consecutive dates at index ${index} of ${year}-${month + 1}`,
        );
      }

      // Exactly the in-month cells are flagged as such.
      assert.equal(grid.filter((cell) => cell.inMonth).length, new Date(year, month + 1, 0).getDate());
    }
  }
});

test("isSameDay and isWeekend behave safely with nulls", () => {
  const today = new Date(2026, 8, 26);
  assert.equal(isSameDay(today, new Date(2026, 8, 26)), true);
  assert.equal(isSameDay(today, new Date(2026, 8, 27)), false);
  assert.equal(isSameDay(null, today), false);
  assert.equal(isSameDay(today, null), false);
  assert.equal(isWeekend(new Date(2026, 8, 26)), true); // Saturday
  assert.equal(isWeekend(new Date(2026, 8, 28)), false); // Monday
});

test("status filter only accepts known values", () => {
  assert.equal(isCalendarFilter("ALL"), true);
  assert.equal(isCalendarFilter("PENDING"), true);
  assert.equal(isCalendarFilter("APPROVED"), true);
  assert.equal(isCalendarFilter("DELETED"), false);
  assert.equal(isCalendarFilter(undefined), false);
});

test("every booking status has a colour tone and a human label", () => {
  for (const status of ["PENDING", "APPROVED", "PREPARING", "COMPLETED", "CANCELLED", "REJECTED"]) {
    const tone = statusTone(status);
    assert.ok(tone.chip.length > 0);
    assert.ok(tone.dot.length > 0);
    assert.equal(statusLabel(status), status.charAt(0) + status.slice(1).toLowerCase());
  }
  // Unknown statuses fall back instead of rendering unstyled.
  assert.ok(statusTone("MYSTERY").chip.length > 0);
});
