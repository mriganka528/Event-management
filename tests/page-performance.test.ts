import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * Page-weight regressions.
 *
 * The slow screens were slow because they transferred data they never painted:
 * the customer dashboard loaded every payment, invoice, service, and package for
 * every booking; the invoice screen loaded every booking with every payment just
 * to filter out the invoiced ones; the booking detail loaded the whole staff
 * roster with assignments. Clerk also shipped its client bundle from the root
 * layout to every route.
 */

test("clerk is not part of the global bundle", () => {
  assert.doesNotMatch(readFileSync("app/layout.tsx", "utf8"), /ClerkProvider/);
  assert.match(readFileSync("app/(customer-auth)/customer/auth/layout.tsx", "utf8"), /ClerkProvider/);
});

test("the customer dashboard only selects what it prints", () => {
  const dashboard = readFileSync("lib/dashboard.ts", "utf8");
  assert.match(dashboard, /select:\s*\{/);
  assert.doesNotMatch(dashboard, /bookingInclude|include:\s*\{\s*payments/);
  assert.match(dashboard, /notifications:\s*\{[\s\S]*take:\s*5/, "notifications must be limited to the five the page shows");
  assert.match(dashboard, /invoice:\s*\{\s*select:\s*\{\s*id:\s*true\s*\}\s*\}/, "the dashboard needs the invoice id for its view link");
});

test("the invoice screen does not load every booking to find a few", () => {
  const data = readFileSync("lib/admin-data.ts", "utf8");
  assert.match(data, /export async function getInvoiceableBookings/);
  const invoiceable = data.slice(
    data.indexOf("export async function getInvoiceableBookings"),
    data.indexOf("export async function getAdminEvents"),
  );
  assert.match(invoiceable, /where:\s*\{[\s\S]*invoice:\s*null/);
  assert.match(invoiceable, /take:\s*100/);
  assert.doesNotMatch(invoiceable, /payments/);

  const page = readFileSync("app/(admin)/admin/invoices/page.tsx", "utf8");
  assert.match(page, /getInvoiceableBookings\(\)/);
  assert.doesNotMatch(page, /getAdminBookings\(\)/);
});

test("the admin invoice list selects names instead of whole accounts", () => {
  const data = readFileSync("lib/admin-data.ts", "utf8");
  const invoiceQuery = data.slice(data.indexOf("export async function getAdminInvoices"), data.indexOf("export async function getInvoiceableBookings"));
  assert.match(invoiceQuery, /customer:\s*\{\s*select:\s*\{\s*user:\s*\{\s*select:/);
  assert.doesNotMatch(invoiceQuery, /customer:\s*\{\s*include:/);
  assert.doesNotMatch(invoiceQuery, /event:\s*true/);
});

test("the booking list does not fetch payments it never shows", () => {
  const source = readFileSync("lib/admin-bookings.ts", "utf8");
  assert.doesNotMatch(source, /payments:\s*true/);
  assert.match(source, /invoice:\s*\{\s*select:\s*\{\s*id:\s*true\s*\}\s*\}/);
});

test("booking detail gets a staff dropdown, not the staff screen's payload", () => {
  const data = readFileSync("lib/admin-data.ts", "utf8");
  assert.match(data, /export async function getStaffOptions/);
  const options = data.slice(data.indexOf("export async function getStaffOptions"), data.indexOf("export async function getAdminCustomers"));
  assert.match(options, /where:\s*\{\s*isAvailable:\s*true/);
  assert.doesNotMatch(options, /assignments|bookingStaff/);

  const detail = readFileSync("app/(admin)/admin/bookings/[id]/page.tsx", "utf8");
  assert.match(detail, /getStaffOptions\(\)/);
  assert.doesNotMatch(detail, /getAdminStaff\(\)/);
});

test("admin routes paint a skeleton while the server works", () => {
  assert.ok(existsSync("app/(admin)/admin/loading.tsx"));
  const loading = readFileSync("app/(admin)/admin/loading.tsx", "utf8");
  assert.match(loading, /WorkspacePageSkeleton/);
});

test("business settings are cached across the layout round trip", () => {
  const settings = readFileSync("lib/settings.ts", "utf8");
  assert.match(settings, /unstable_cache/);
  assert.match(settings, /tags:\s*\[BUSINESS_SETTINGS_TAG\]/);
  assert.match(settings, /revalidate:\s*300/);

  for (const layout of ["app/(admin)/admin/layout.tsx", "app/(customer)/customer/layout.tsx"]) {
    assert.match(readFileSync(layout, "utf8"), /getBusinessSettings\(\)/, `${layout} must use the cached profile`);
  }

  const actions = readFileSync("lib/actions.ts", "utf8");
  assert.match(actions, /updateTag\(BUSINESS_SETTINGS_TAG\)/, "saving the profile must invalidate the cache");
});

test("the hot reads join their relations instead of paying a round trip each", () => {
  // Prisma's default `query` strategy issues a separate statement per relation.
  // The account resolve alone is six statements (session, user, role, customer,
  // admin, staff); on a remote Neon endpoint each is a network round trip, which
  // is where the eight-second page loads came from. `join` makes each of these
  // screens one statement.
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /previewFeatures\s*=\s*\["relationJoins"\]/, "the join strategy needs the relationJoins preview");

  for (const file of [
    "lib/auth/server.ts",
    "lib/dashboard.ts",
    "lib/admin-bookings.ts",
    "lib/bookings.ts",
    "lib/invoices.ts",
    "lib/admin-data.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /relationLoadStrategy:\s*"join"/, `${file} still resolves relations one query at a time`);
  }
});
