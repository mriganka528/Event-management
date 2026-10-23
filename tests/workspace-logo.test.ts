import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The business logo, in the places that were missing it.
 *
 * The public header has always shown it. The workspaces did not: the customer
 * dashboard, the staff workspace, and the admin sidebar showed the business
 * name alone, so a business that had uploaded a logo saw it on the marketing
 * site and nowhere else.
 */

const customerLayout = readFileSync("app/(customer)/customer/layout.tsx", "utf8");
const staffLayout = readFileSync("app/(staff)/staff/layout.tsx", "utf8");
const sidebar = readFileSync("app/(admin)/admin/component/admin-sidebar.tsx", "utf8");
const adminLayout = readFileSync("app/(admin)/admin/layout.tsx", "utf8");
// The two workspaces render the logo through one shared component, so the
// image itself lives there rather than being copied into each layout.
const businessLogo = readFileSync("components/layout/business-logo.tsx", "utf8");

test("the customer dashboard shows the logo", () => {
  assert.match(customerLayout, /logoUrl/, "the customer layout must read the logo");
  assert.match(customerLayout, /<BusinessLogo[\s\S]{0,200}logoUrl=\{logoUrl\}/, "the customer layout must render it");
  // The name stays either way, so a business without artwork is not left with
  // a gap where the logo would have been.
  assert.match(customerLayout, /\{businessName\}/, "the name must still be rendered");
});

test("the staff workspace shows the logo", () => {
  assert.match(staffLayout, /logoUrl/, "the staff layout must read the logo");
  assert.match(staffLayout, /<BusinessLogo[\s\S]{0,200}logoUrl=\{settings\.logoUrl\}/, "the staff layout must render it");
});

test("the admin sidebar shows the logo", () => {
  assert.match(sidebar, /logoUrl/, "the sidebar must accept the logo");
  assert.match(sidebar, /<Image[\s\S]{0,400}src=\{logoUrl\}/, "the sidebar must render it");
  assert.match(adminLayout, /logoUrl=\{settings\.logoUrl\}/, "the admin layout must hand the logo to the sidebar");
});

test("the shared logo component renders the image", () => {
  // The workspaces and the sidebar must agree on how the logo looks, so the
  // image itself is in one place rather than copied into each.
  assert.match(businessLogo, /<Image[\s\S]{0,400}src=\{logoUrl\}/, "the shared component must render the image");
  // A logo on a light surface needs an edge of its own, or a pale upload is
  // invisible against the card behind it.
  assert.match(businessLogo, /bg-white/, "the logo needs a surface of its own");
  assert.match(businessLogo, /border/, "and a border, so it reads as a logo rather than as blank space");
});

test("the logo is served through the image optimiser, not a raw tag", () => {
  // A raw <img> would bypass the optimiser and the size rules, and would
  // pull the original asset across the wire on every page.
  for (const source of [customerLayout, staffLayout, sidebar, businessLogo]) {
    assert.doesNotMatch(source, /<img\s/, "the logo must go through next/image");
  }
});
