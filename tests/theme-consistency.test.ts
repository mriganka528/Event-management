import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Theme consistency regressions.
 *
 * Two surfaces were reported as "the wrong colour": the operational-readiness
 * card and the upcoming-events spotlight were painted with a fixed dark
 * gradient even in the light theme, and the payment summary borrowed its own
 * palette. The dark gradient is now gone, and status colours come from the same
 * semantic tokens the rest of the workspace uses.
 */

test("booking statuses share one token-based palette", () => {
  const helper = readFileSync("lib/booking-status.ts", "utf8");
  for (const token of ["--success-soft", "--warning-soft", "--danger-soft", "--surface-strong", "--brand-soft"]) {
    assert.match(helper, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `status helper must use ${token}`);
  }
  assert.doesNotMatch(helper, /bg-stone-900|bg-emerald-100|bg-amber-100|bg-red-100/);

  for (const path of [
    "app/(admin)/admin/bookings/page.tsx",
    "app/(admin)/admin/bookings/[id]/page.tsx",
    "app/(customer)/customer/dashboard/page.tsx",
    "app/(customer)/customer/bookings/[id]/page.tsx",
  ]) {
    const page = readFileSync(path, "utf8");
    assert.match(page, /bookingStatusBadgeClass/, `${path} must use the shared status palette`);
    assert.doesNotMatch(page, /function (get)?[sS]tatusClass\(/, `${path} still defines a local status palette`);
  }
});

test("the operational readiness card follows the active theme", () => {
  const detail = readFileSync("app/(admin)/admin/bookings/[id]/page.tsx", "utf8");
  const readiness = detail.slice(detail.indexOf("Operational readiness") - 2_000, detail.indexOf("Operational readiness") + 2_000);
  assert.match(readiness, /bg-\[var\(--card\)\]|bg-\[var\(--surface-muted\)\]/);
  assert.doesNotMatch(readiness, /bg-stone-950|bg-stone-900|text-white/);
  assert.doesNotMatch(detail, /bg-(red|amber|emerald|white)-[0-9]|text-(red|amber|emerald|white|black)-[0-9]/);
});

test("the upcoming spotlight is not a fixed dark card", () => {
  const page = readFileSync("app/(admin)/admin/bookings/page.tsx", "utf8");
  assert.doesNotMatch(page, /rgba\(35,27,21|rgba\(37,28,22/);
  const spotlight = page.slice(page.indexOf("Upcoming spotlight") - 800, page.indexOf("Upcoming spotlight") + 1_200);
  assert.match(spotlight, /bg-\[var\(--surface-muted\)\]/);
  assert.match(spotlight, /border-\[var\(--line\)\]/);
});

test("the finance desk uses the workspace palette", () => {
  const page = readFileSync("app/(admin)/admin/payments/page.tsx", "utf8");
  assert.doesNotMatch(page, /text-amber-700|bg-emerald-100|text-emerald-800|text-amber-800/);
  assert.match(page, /text-\[var\(--brand-dark\)\]/);
  assert.match(page, /bg-\[var\(--success-soft\)\]/);
  assert.match(page, /bg-\[var\(--warning-soft\)\]/);
});

test("the public tracking page no longer uses light-only stone surfaces", () => {
  const page = readFileSync("app/(customer)/customer/track/page.tsx", "utf8");
  assert.doesNotMatch(page, /bg-stone-50|text-amber-700|bg-amber-100|bg-emerald-100/);
  assert.match(page, /bg-\[var\(--surface-muted\)\]/);
  assert.match(page, /bookingStatusBadgeClass/);
});

test("the invoice view is themed rather than black-on-white only", () => {
  const document = readFileSync("components/invoices/invoice-document.tsx", "utf8");
  for (const token of ["--card", "--surface-muted", "--line", "--brand-soft", "--brand-softer", "--success-soft", "--warning-soft", "--danger-soft"]) {
    assert.match(document, new RegExp(token));
  }
  assert.doesNotMatch(document, /bg-white|text-black|bg-stone-/);
});
